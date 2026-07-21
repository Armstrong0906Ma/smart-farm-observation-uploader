import { cloudTasksEnabled, enqueueDashboardPublish, enqueueDataHubPublish } from '@/lib/cloudTasks';
import { publishObservationDashboardAndRecord } from '@/lib/dashboardPublicationFlow';
import {
  dashboardPublishingEnabled,
  isDashboardObservationCandidate
} from '@/lib/dashboardPublisher';
import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';
import {
  getModelingJob,
  getObservationByModelingJobId,
  getOrCreateObservationByModelingJobId,
  markObservationDashboardFailure,
  prepareObservationDashboardPublication,
  transitionModelingJob
} from '@/lib/repositories';
import { uploadObservationAndRecord } from '@/lib/uploadObservationFlow';
import { modelingResultSchema } from '@/lib/validation';

const ACTIVE_STATUSES = ['queued', 'dispatching', 'processing'];
const SUCCESS_ACCEPTING_STATUSES = [...ACTIVE_STATUSES, 'failed'];

function gcsObjectPath(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.hostname === 'storage.googleapis.com') {
    return decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
  }
  if (url.hostname.endsWith('.storage.googleapis.com')) {
    return decodeURIComponent(url.pathname.slice(1));
  }
  return null;
}

function completionMatches(left, right) {
  if (JSON.stringify(left) === JSON.stringify(right)) return true;
  if (left?.status !== 'succeeded' || right?.status !== 'succeeded') return false;
  const leftObject = gcsObjectPath(left.annotatedGlbUrl);
  const rightObject = gcsObjectPath(right.annotatedGlbUrl);
  if (!leftObject || leftObject !== rightObject) return false;
  const leftRest = { ...left };
  const rightRest = { ...right };
  delete leftRest.annotatedGlbUrl;
  delete rightRest.annotatedGlbUrl;
  return JSON.stringify(leftRest) === JSON.stringify(rightRest);
}

function resultFromObservation(observation) {
  return {
    status: 'succeeded',
    plantId: observation.plantId,
    observedAt: observation.observedAt,
    height: observation.height,
    nodes: observation.nodes,
    internodeStatistics: observation.internodeStatistics,
    gifUrl: observation.gifUrl,
    ...(observation.analysisGifUrl ? { analysisGifUrl: observation.analysisGifUrl } : {}),
    ...(observation.frontImageUrl ? { frontImageUrl: observation.frontImageUrl } : {}),
    ...(observation.rightImageUrl ? { rightImageUrl: observation.rightImageUrl } : {}),
    glbUrl: observation.glbUrl,
    annotatedGlbUrl: observation.annotatedGlbUrl,
    measurementUrl: observation.measurementUrl,
    nodesCsvUrl: observation.nodesCsvUrl,
    ...(observation.calibrationProfile ? { calibrationProfile: observation.calibrationProfile } : {}),
    ...(observation.modelToCmScale ? { modelToCmScale: observation.modelToCmScale } : {})
  };
}

function replayConflict() {
  const error = new Error('Callback replay payload does not match the original completion');
  error.status = 409;
  return error;
}

function completedProgress(job) {
  return {
    ...(job.progress || {}),
    phase: 'completed',
    overallPercent: 100,
    updatedAt: new Date().toISOString()
  };
}

function initialDashboardState(result) {
  if (result.plantId !== 'C-1-1') {
    return { dashboardStatus: 'not_applicable', dashboardLastError: null };
  }
  if (!isDashboardObservationCandidate(result)) {
    return {
      dashboardStatus: 'failed',
      dashboardLastError: 'C-1-1 completion is missing front, right, or analysis GIF media'
    };
  }
  return {
    dashboardStatus: dashboardPublishingEnabled() ? 'pending' : 'disabled',
    dashboardLastError: null
  };
}

async function scheduleDashboardPublication(observation) {
  if (observation.plantId === 'C-1-1' && !isDashboardObservationCandidate(observation)) {
    return await markObservationDashboardFailure(
      observation.id,
      'C-1-1 completion is missing front, right, or analysis GIF media'
    ) || observation;
  }
  if (!dashboardPublishingEnabled() || !isDashboardObservationCandidate(observation)) {
    return observation;
  }
  const prepared = await prepareObservationDashboardPublication(observation.id);
  if (!prepared) return observation;
  if (cloudTasksEnabled()) {
    try {
      await enqueueDashboardPublish(prepared.id);
    } catch (error) {
      await markObservationDashboardFailure(prepared.id, 'Could not enqueue Dashboard publication');
      throw error;
    }
    return prepared;
  }
  return publishObservationDashboardAndRecord(prepared, { throwOnFailure: true });
}

export async function POST(request, { params }) {
  try {
    requireInternalToken(request);
    const { id } = await params;
    const result = modelingResultSchema.parse(await request.json());
    let job = await getModelingJob(id);
    if (!job) {
      const error = new Error('找不到建模任務');
      error.status = 404;
      throw error;
    }
    if (job.status === 'cancelled') {
      const error = new Error('Modeling job was cancelled');
      error.status = 409;
      throw error;
    }
    if (job.status === 'succeeded') {
      let observation = await getObservationByModelingJobId(id);
      const original = job.completionResult || (observation && resultFromObservation(observation));
      if (!original || !completionMatches(original, result)) throw replayConflict();
      if (observation && ['pending', 'failed'].includes(observation.uploadStatus) && cloudTasksEnabled()) {
        await enqueueDataHubPublish(observation.id);
      }
      if (observation) observation = await scheduleDashboardPublication(observation);
      return json({ job, observation });
    }
    if (job.status === 'failed') {
      if (job.completionResult && completionMatches(job.completionResult, result)) {
        return json({ job });
      }
      if (result.status === 'failed'
        || (job.completionResult && job.completionResult.status !== 'failed')) throw replayConflict();
    }
    if (result.status === 'failed') {
      job = await transitionModelingJob(id, ACTIVE_STATUSES, {
        status: 'failed',
        error: result.error,
        'progress.phase': 'failed',
        'progress.updatedAt': new Date().toISOString(),
        completionResult: result
      }) || await getModelingJob(id);
      if (!completionMatches(job.completionResult, result)) throw replayConflict();
      return json({ job });
    }
    if (result.plantId !== job.plantId || result.observedAt !== job.observedAt) {
      const error = new Error('Callback job metadata mismatch');
      error.status = 409;
      throw error;
    }
    const expectedCalibrationProfile = job.submissionSource === 'robot_camera' ? 'robot_camera' : 'manual';
    if (expectedCalibrationProfile === 'robot_camera'
      && (!result.calibrationProfile || result.modelToCmScale === undefined)) {
      const error = new Error('Robot-camera callback is missing calibration audit data');
      error.status = 409;
      throw error;
    }
    if (result.calibrationProfile && result.calibrationProfile !== expectedCalibrationProfile) {
      const error = new Error('Callback calibration profile mismatch');
      error.status = 409;
      throw error;
    }

    let observation;
    try {
      observation = await getOrCreateObservationByModelingJobId({
        plantId: result.plantId,
        observedAt: result.observedAt,
        height: result.height,
        nodes: result.nodes,
        internodeStatistics: result.internodeStatistics,
        gifUrl: result.gifUrl,
        analysisGifUrl: result.analysisGifUrl,
        frontImageUrl: result.frontImageUrl,
        rightImageUrl: result.rightImageUrl,
        glbUrl: result.glbUrl,
        annotatedGlbUrl: result.annotatedGlbUrl,
        measurementUrl: result.measurementUrl,
        nodesCsvUrl: result.nodesCsvUrl,
        calibrationProfile: result.calibrationProfile,
        modelToCmScale: result.modelToCmScale,
        ...initialDashboardState(result),
        modelingJobId: id,
        note: 'two-view Hunyuan 3D analysis'
      }, { uid: job.createdBy });
    } catch (error) {
      if (error.code !== 'OBSERVATION_NATURAL_KEY_CONFLICT') throw error;
      job = await transitionModelingJob(id, SUCCESS_ACCEPTING_STATUSES, {
        status: 'failed',
        error: 'Observation creation failed: plant and observed time already belong to another observation',
        failureCode: 'observation_natural_key_conflict',
        'progress.phase': 'failed',
        'progress.updatedAt': new Date().toISOString(),
        completionResult: result,
        calibrationProfile: result.calibrationProfile || expectedCalibrationProfile,
        modelToCmScale: result.modelToCmScale ?? null
      }) || await getModelingJob(id);
      return json({ job });
    }

    if (!completionMatches(resultFromObservation(observation), result)) throw replayConflict();

    if (cloudTasksEnabled()) {
      job = await transitionModelingJob(id, SUCCESS_ACCEPTING_STATUSES, {
        status: 'succeeded',
        error: null,
        observationId: observation.id,
        dataHubStatus: observation.uploadStatus,
        progress: completedProgress(job),
        completionResult: result,
        calibrationProfile: result.calibrationProfile || expectedCalibrationProfile,
        modelToCmScale: result.modelToCmScale ?? null
      }) || await getModelingJob(id);
      await enqueueDataHubPublish(observation.id);
      observation = await scheduleDashboardPublication(observation);
      return json({ job, observation });
    }
    observation = await uploadObservationAndRecord(observation);
    job = await transitionModelingJob(id, SUCCESS_ACCEPTING_STATUSES, {
      status: 'succeeded',
      error: null,
      observationId: observation.id,
      dataHubStatus: observation.uploadStatus,
      progress: completedProgress(job),
      completionResult: result,
      calibrationProfile: result.calibrationProfile || expectedCalibrationProfile,
      modelToCmScale: result.modelToCmScale ?? null
    }) || await getModelingJob(id);
    observation = await scheduleDashboardPublication(observation);
    return json({ job, observation });
  } catch (error) {
    if (error.name === 'ZodError') {
      const details = error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }));
      console.error('Invalid modeling completion payload', details);
      return json({ error: '建模結果格式錯誤', details }, 400);
    }
    console.error('Modeling completion failed', error);
    return errorResponse(error);
  }
}
