import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { deleteUnsyncedObservation, getObservation, getPlant, updateUnsyncedObservation } from '@/lib/repositories';
import { observationUpdateSchema } from '@/lib/validation';

export async function GET(request, { params }) {
  try {
    await requireUser(request);
    const observation = await getObservation(params.id);
    if (!observation) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }
    return json({ observation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    await requireUser(request);
    const payload = observationUpdateSchema.parse(await request.json());
    const plant = await getPlant(payload.plantId);
    if (!plant || !plant.enabled) {
      const error = new Error('植株編號不存在或未啟用');
      error.status = 400;
      throw error;
    }
    const observation = await updateUnsyncedObservation(params.id, payload);
    return json({ observation });
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = '輸入資料格式錯誤';
    }
    return errorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    await requireUser(request);
    await deleteUnsyncedObservation(params.id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
