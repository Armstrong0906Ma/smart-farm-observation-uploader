import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { listRecentImportBatches } from '@/lib/repositories';

export async function GET(request) {
  try {
    await requireUser(request);
    const { searchParams } = new URL(request.url);
    const batches = await listRecentImportBatches(searchParams.get('limit') || 20);
    return json({ batches });
  } catch (error) {
    return errorResponse(error);
  }
}
