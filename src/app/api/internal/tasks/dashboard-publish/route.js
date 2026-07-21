import { publishObservationDashboardAndRecord } from '@/lib/dashboardPublicationFlow';
import { isDashboardObservationCandidate } from '@/lib/dashboardPublisher';
import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';
import { getObservation, prepareObservationDashboardPublication } from '@/lib/repositories';
import { dashboardTaskSchema } from '@/lib/validation';

export async function POST(request) {
  try {
    requireInternalToken(request);
    const { observationId } = dashboardTaskSchema.parse(await request.json());
    let observation = await getObservation(observationId);
    if (!observation) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }
    if (isDashboardObservationCandidate(observation)) {
      observation = await prepareObservationDashboardPublication(observation.id) || observation;
    }
    const updated = await publishObservationDashboardAndRecord(observation, { throwOnFailure: true });
    return json({ observation: updated });
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = 'Invalid Dashboard task payload';
    }
    return errorResponse(error);
  }
}
