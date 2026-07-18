import { cloudTasksEnabled, enqueueDataHubPublish } from '@/lib/cloudTasks';
import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';
import {
  getModelingJob,
  getObservationByModelingJobId,
  getOrCreateObservationByModelingJobId,
  transitionModelingJob
} from '@/lib/repositories';
import { uploadObservationAndRecord } from '@/lib/uploadObservationFlow';
import { modelingResultSchema } from '@/lib/validation';

const ACTIVE_STATUSES = ['queued', 'dispatching', 'processing'];

function completionMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    glbUrl: observation.glbUrl,
    annotatedGlbUrl: observation.annotatedGlbUrl,
    measurementUrl: observation.measurementUrl,
    nodesCsvUrl: observation.nodesCsvUrl
  };
}

function replayConflict() {
  const error = new Error('Callback replay payload does not match the original completion');
  error.status = 409;
  return error;
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
    if (job.status === 'succeeded') {
      const observation = await getObservationByModelingJobId(id);
      const original = job.completionResult || (observation && resultFromObservation(observation));
      if (!original || !completionMatches(original, result)) throw replayConflict();
      if (observation && ['pending', 'failed'].includes(observation.uploadStatus) && cloudTasksEnabled()) {
        await enqueueDataHubPublish(observation.id);
      }
      return json({ job, observation });
    }
    if (job.status === 'failed') {
      if (!job.completionResult || !completionMatches(job.completionResult, result)) throw replayConflict();
      return json({ job });
    }
    if (result.status === 'failed') {
      job = await transitionModelingJob(id, ACTIVE_STATUSES, {
        status: 'failed',
        error: result.error,
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

    let observation;
    try {
      observation = await getOrCreateObservationByModelingJobId({
        plantId: result.plantId,
        observedAt: result.observedAt,
        height: result.height,
        nodes: result.nodes,
        internodeStatistics: result.internodeStatistics,
        gifUrl: result.gifUrl,
        glbUrl: result.glbUrl,
        annotatedGlbUrl: result.annotatedGlbUrl,
        measurementUrl: result.measurementUrl,
        nodesCsvUrl: result.nodesCsvUrl,
        modelingJobId: id,
        note: 'two-view Hunyuan 3D analysis'
      }, { uid: job.createdBy });
    } catch (error) {
      if (error.code !== 'OBSERVATION_NATURAL_KEY_CONFLICT') throw error;
      job = await transitionModelingJob(id, ACTIVE_STATUSES, {
        status: 'failed',
        error: 'Observation creation failed: plant and observed time already belong to another observation',
        failureCode: 'observation_natural_key_conflict',
        completionResult: result
      }) || await getModelingJob(id);
      return json({ job });
    }

    if (!completionMatches(resultFromObservation(observation), result)) throw replayConflict();

    if (cloudTasksEnabled()) {
      job = await transitionModelingJob(id, ACTIVE_STATUSES, {
        status: 'succeeded',
        error: null,
        observationId: observation.id,
        dataHubStatus: observation.uploadStatus,
        completionResult: result
      }) || await getModelingJob(id);
      await enqueueDataHubPublish(observation.id);
      return json({ job, observation });
    }
    observation = await uploadObservationAndRecord(observation);
    job = await transitionModelingJob(id, ACTIVE_STATUSES, {
      status: 'succeeded',
      error: null,
      observationId: observation.id,
      dataHubStatus: observation.uploadStatus,
      completionResult: result
    }) || await getModelingJob(id);
    return json({ job, observation });
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = '建模結果格式錯誤';
    }
    return errorResponse(error);
  }
}
