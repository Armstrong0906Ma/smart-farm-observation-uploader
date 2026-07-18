import { errorResponse, json } from '@/lib/http';
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
    if (job.status === 'dispatching') {
      job = await transitionModelingJob(jobId, ['dispatching'], {
        status: 'failed',
        error: 'Modeling dispatch was interrupted and was not retried to avoid duplicate quota usage'
      }) || await getModelingJob(jobId);
      await deleteModelingSourceImages(job).catch(() => {});
      return json({ job });
    }
    if (job.status !== 'queued') return json({ job });
    job = await transitionModelingJob(jobId, ['queued'], { status: 'dispatching', error: null });
    if (!job) return json({ job: await getModelingJob(jobId) });

    try {
      const images = await loadModelingSourceImages(job);
      await dispatchModelingJob(job, images);
      job = await transitionModelingJob(jobId, ['dispatching'], { status: 'processing', error: null }) || await getModelingJob(jobId);
      await deleteModelingSourceImages(job).catch(() => {});
      return json({ job });
    } catch (error) {
      job = await transitionModelingJob(jobId, ['dispatching'], { status: 'failed', error: error.message }) || await getModelingJob(jobId);
      await deleteModelingSourceImages(job).catch(() => {});
      // Do not retry a dispatch automatically: the worker may already have consumed paid quota.
      return json({ job });
    }
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = 'Invalid modeling task payload';
    }
    return errorResponse(error);
  }
}
