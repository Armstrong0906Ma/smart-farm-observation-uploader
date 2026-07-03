import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { listPlants } from '@/lib/repositories';

export async function GET(request) {
  try {
    await requireUser(request);
    const plants = await listPlants();
    return json({ plants });
  } catch (error) {
    return errorResponse(error);
  }
}
