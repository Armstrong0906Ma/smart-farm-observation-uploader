import { errorResponse, json } from '@/lib/http';
import { ensureHunyuanWorkerReady } from '@/lib/gceWorker';
import { requireInternalToken } from '@/lib/internalAuth';
import { dispatchModelingJob } from '@/lib/modelingDispatch';
import {
  deleteModelingSourceImages,
  getModelingJob,
  loadModelingSourceImages,
  transitionModelingJob
} from '@/lib/repositories';
import { modelingTaskSchema } from '@/lib/validation';

export async function POST(request) {
  try {
    requireInternalToken(request);
    const { jobId } = modelingTaskSchema.parse(await request.json());
    let job = await getModelingJob(jobId);
    if (!job) {
      const error = new Error('找不到建模任務');
      error.status = 404;
      throw error;
    }
    if (!['queued', 'dispatching'].includes(job.status)) return json({ job });
    if (job.status === 'queued') {
      job = await transitionModelingJob(jobId, ['queued'], {
        status: 'dispatching',
        error: null,
        progress: {
          phase: 'dispatching',
          overallPercent: 5,
          remotePercent: null,
          remoteStatus: null,
          updatedAt: new Date().toISOString()
        }
      });
      if (!job) return json({ job: await getModelingJob(jobId) });
    }

    try {
      await ensureHunyuanWorkerReady();
      const images = await loadModelingSourceImages(job);
      await dispatchModelingJob(job, images);
      job = await transitionModelingJob(jobId, ['dispatching'], {
        status: 'processing',
        error: null
      }) || await getModelingJob(jobId);
      await deleteModelingSourceImages(job).catch(() => {});
      return json({ job });
    } catch (error) {
      if (error.terminal) {
        job = await transitionModelingJob(jobId, ['dispatching'], {
          status: 'failed',
          error: error.message,
          'progress.phase': 'failed',
          'progress.updatedAt': new Date().toISOString()
        }) || await getModelingJob(jobId);
        await deleteModelingSourceImages(job).catch(() => {});
        return json({ job });
      }
      // The worker enqueues by job ID before returning 202, so response loss is safe to retry.
      // Keep source images and dispatching state until Cloud Tasks redelivers this task.
      throw error;
    }
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = 'Invalid modeling task payload';
    }
    return errorResponse(error);
  }
}
