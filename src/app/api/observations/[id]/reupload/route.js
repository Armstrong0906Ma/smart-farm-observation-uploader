import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { getObservation } from '@/lib/repositories';
import { uploadObservationAndRecord } from '@/lib/uploadObservationFlow';

export async function POST(request, { params }) {
  try {
    await requireUser(request);
    const observation = await getObservation(params.id);
    if (!observation) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }
    const uploaded = await uploadObservationAndRecord(observation);
    return json({ observation: uploaded });
  } catch (error) {
    return errorResponse(error);
  }
}
