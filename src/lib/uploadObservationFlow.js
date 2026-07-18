import {
  addUploadAttempt,
  claimObservationUpload,
  finishObservationUpload,
  getObservation,
  updateModelingJob
} from '@/lib/repositories';
import { uploadObservation } from '@/lib/uploaders';

async function updateModelingDataHubStatus(observation) {
  if (observation?.modelingJobId) {
    await updateModelingJob(observation.modelingJobId, { dataHubStatus: observation.uploadStatus });
  }
}

export async function uploadObservationAndRecord(observation, { throwOnFailure = false } = {}) {
  const claimed = await claimObservationUpload(observation.id);
  if (!claimed) return getObservation(observation.id);
  const current = claimed.observation;
  await updateModelingDataHubStatus(current);
  try {
    const result = await uploadObservation(current);
    await addUploadAttempt({
      observationId: current.id,
      adapter: result.adapter,
      status: 'uploaded',
      errorMessage: null
    });
    const updated = await finishObservationUpload(current.id, claimed.claimId, {
      uploadStatus: 'uploaded',
      uploadedAt: new Date().toISOString(),
      lastError: null
    });
    await updateModelingDataHubStatus(updated);
    return updated;
  } catch (error) {
    await addUploadAttempt({
      observationId: current.id,
      adapter: process.env.DATAHUB_UPLOADER || 'mock',
      status: 'failed',
      errorMessage: error.message
    });
    const updated = await finishObservationUpload(current.id, claimed.claimId, {
      uploadStatus: 'failed',
      lastError: error.message
    });
    await updateModelingDataHubStatus(updated);
    if (throwOnFailure) throw error;
    return updated;
  }
}
