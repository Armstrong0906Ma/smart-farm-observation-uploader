import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';
import { getObservation } from '@/lib/repositories';
import { uploadObservationAndRecord } from '@/lib/uploadObservationFlow';
import { dataHubTaskSchema } from '@/lib/validation';

export async function POST(request) {
  try {
    requireInternalToken(request);
    const { observationId } = dataHubTaskSchema.parse(await request.json());
    const observation = await getObservation(observationId);
    if (!observation) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }
    const updated = await uploadObservationAndRecord(observation, { throwOnFailure: true });
    if (updated?.uploadStatus === 'uploading') {
      const error = new Error('DataHub upload is already in progress');
      error.status = 409;
      throw error;
    }
    return json({ observation: updated });
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = 'Invalid DataHub task payload';
    }
    return errorResponse(error);
  }
}
