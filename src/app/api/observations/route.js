import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { createObservation, getPlant, listObservations } from '@/lib/repositories';
import { observationCreateSchema } from '@/lib/validation';

export async function GET(request) {
  try {
    await requireUser(request);
    const { searchParams } = new URL(request.url);
    const result = await listObservations({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 10
    });
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const payload = observationCreateSchema.parse(await request.json());
    const plant = await getPlant(payload.plantId);
    if (!plant || !plant.enabled) {
      const error = new Error('植株編號不存在或未啟用');
      error.status = 400;
      throw error;
    }
    const observation = await createObservation(payload, user);
    return json({ observation }, 201);
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = '輸入資料格式錯誤';
    }
    return errorResponse(error);
  }
}
