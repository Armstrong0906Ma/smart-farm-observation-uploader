import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import { submitModelingJob } from '@/lib/modelingSubmission';
import { getPlant, listActiveModelingJobs } from '@/lib/repositories';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function validateImage(file, label) {
  if (!(file instanceof File) || file.size === 0) {
    const error = new Error(`請選擇${label}照片`);
    error.status = 400;
    throw error;
  }
  if (!file.type.startsWith('image/')) {
    const error = new Error(`${label}檔案必須是圖片`);
    error.status = 400;
    throw error;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const error = new Error(`${label}照片不可超過 15 MB`);
    error.status = 400;
    throw error;
  }
}

async function imageData(file) {
  return { buffer: Buffer.from(await file.arrayBuffer()), name: file.name, type: file.type };
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const form = await request.formData();
    const plantId = String(form.get('plantId') || '').trim();
    const observedAt = String(form.get('observedAt') || '');
    const submissionKey = String(form.get('submissionKey') || '').trim();
    const front = form.get('front');
    const right = form.get('right');
    if (!plantId || !Number.isFinite(new Date(observedAt).getTime())) {
      const error = new Error('植株編號或觀測時間格式錯誤');
      error.status = 400;
      throw error;
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(submissionKey)) {
      const error = new Error('Submission idempotency key is missing or invalid');
      error.status = 400;
      throw error;
    }
    validateImage(front, '正面');
    validateImage(right, '右側');
    const plant = await getPlant(plantId);
    if (!plant || !plant.enabled) {
      const error = new Error('植株編號不存在或未啟用');
      error.status = 400;
      throw error;
    }

    const result = await submitModelingJob({
      plantId,
      observedAt: new Date(observedAt).toISOString(),
      submissionKey,
      user,
      images: { front: await imageData(front), right: await imageData(right) }
    });
    return json({ job: result.job, replayed: result.replayed }, result.replayed ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request) {
  try {
    await requireUser(request);
    return json({ jobs: await listActiveModelingJobs() });
  } catch (error) {
    return errorResponse(error);
  }
}
