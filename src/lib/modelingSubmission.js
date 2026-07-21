import { cloudTasksEnabled, enqueueModelingDispatch } from '@/lib/cloudTasks';
import { dispatchModelingJob } from '@/lib/modelingDispatch';
import {
  createModelingJob,
  deleteModelingSourceImages,
  getModelingJob,
  saveModelingSourceImages,
  transitionModelingJob
} from '@/lib/repositories';

export async function submitModelingJob({
  plantId,
  observedAt,
  submissionKey,
  user,
  images,
  submissionSource = 'manual',
  failOnPreparationError = true
}) {
  const useTasks = cloudTasksEnabled();
  const createdJob = await createModelingJob({
    plantId,
    observedAt,
    submissionKey,
    user,
    submissionSource
  });
  let job = createdJob.job;
  if (!createdJob.created && job.status !== 'queued') {
    return { job, created: false, replayed: true };
  }

  try {
    if (useTasks) {
      if (!job.sourceImageIds?.front || !job.sourceImageIds?.right) {
        await saveModelingSourceImages(job.id, images);
      }
      await enqueueModelingDispatch(job.id);
      return { job, created: createdJob.created, replayed: !createdJob.created };
    }

    await dispatchModelingJob(job, images);
    job = await transitionModelingJob(job.id, ['queued', 'dispatching', 'processing'], {
      status: 'processing',
      error: null
    }) || job;
    return { job, created: createdJob.created, replayed: !createdJob.created };
  } catch (error) {
    if (failOnPreparationError && createdJob.created) {
      const storedJob = await getModelingJob(job.id).catch(() => null);
      await transitionModelingJob(job.id, ['queued', 'dispatching', 'processing'], {
        status: 'failed',
        error: error.message,
        'progress.phase': 'failed',
        'progress.updatedAt': new Date().toISOString()
      }).catch(() => {});
      if (storedJob) await deleteModelingSourceImages(storedJob).catch(() => {});
    }
    throw error;
  }
}
