import { addUploadAttempt, updateObservationUpload } from '@/lib/repositories';
import { uploadObservation } from '@/lib/uploaders';

export async function uploadObservationAndRecord(observation) {
  await updateObservationUpload(observation.id, { uploadStatus: 'uploading', lastError: null });
  try {
    const result = await uploadObservation(observation);
    await addUploadAttempt({
      observationId: observation.id,
      adapter: result.adapter,
      status: 'uploaded',
      errorMessage: null
    });
    return updateObservationUpload(observation.id, {
      uploadStatus: 'uploaded',
      uploadedAt: new Date().toISOString(),
      lastError: null
    });
  } catch (error) {
    await addUploadAttempt({
      observationId: observation.id,
      adapter: process.env.DATAHUB_UPLOADER || 'mock',
      status: 'failed',
      errorMessage: error.message
    });
    return updateObservationUpload(observation.id, {
      uploadStatus: 'failed',
      retryCount: (observation.retryCount || 0) + 1,
      lastError: error.message
    });
  }
}
