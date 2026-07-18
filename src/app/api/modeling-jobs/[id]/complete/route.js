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
      if (observation && ['pending', 'failed'].includes(observation.uploadStatus) && cloudTasksEnabled()) {
        await enqueueDataHubPublish(observation.id);
      }
      return json({ job, observation });
    }
    if (job.status === 'failed') return json({ job });
    if (result.status === 'failed') {
      job = await transitionModelingJob(id, ACTIVE_STATUSES, { status: 'failed', error: result.error }) || await getModelingJob(id);
      return json({ job });
    }
    if (result.plantId !== job.plantId || result.observedAt !== job.observedAt) {
      const error = new Error('Callback job metadata mismatch');
      error.status = 409;
      throw error;
    }

    let observation = await getOrCreateObservationByModelingJobId({
      plantId: result.plantId,
      observedAt: result.observedAt,
      height: result.height,
      nodes: result.nodes,
      internodeStatistics: result.internodeStatistics,
      gifUrl: result.gifUrl,
      glbUrl: result.glbUrl,
      annotatedGlbUrl: result.annotatedGlbUrl,
      measurementUrl: result.measurementUrl,
      modelingJobId: id,
      source: 'robot_vision',
      note: 'two-view Hunyuan 3D analysis'
    }, { uid: job.createdBy });

    if (cloudTasksEnabled()) {
      job = await transitionModelingJob(id, ACTIVE_STATUSES, {
        status: 'succeeded',
        error: null,
        observationId: observation.id,
        dataHubStatus: observation.uploadStatus
      }) || await getModelingJob(id);
      await enqueueDataHubPublish(observation.id);
      return json({ job, observation });
    }
    observation = await uploadObservationAndRecord(observation);
    job = await transitionModelingJob(id, ACTIVE_STATUSES, {
      status: 'succeeded',
      error: null,
      observationId: observation.id,
      dataHubStatus: observation.uploadStatus
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
