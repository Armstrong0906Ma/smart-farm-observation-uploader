import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { listUnsyncedObservations } from '@/lib/repositories';
import { uploadObservationAndRecord } from '@/lib/uploadObservationFlow';

export async function POST(request) {
  try {
    await requireUser(request);
    const observations = await listUnsyncedObservations();
    const results = [];

    for (const observation of observations) {
      const updated = await uploadObservationAndRecord(observation);
      results.push(updated);
    }

    return json({
      total: results.length,
      uploaded: results.filter(item => item.uploadStatus === 'uploaded').length,
      failed: results.filter(item => item.uploadStatus === 'failed').length,
      observations: results
    });
  } catch (error) {
    return errorResponse(error);
  }
}
