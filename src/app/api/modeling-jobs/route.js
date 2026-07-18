import { requireUser } from '@/lib/authServer';
import { cloudTasksEnabled, enqueueModelingDispatch } from '@/lib/cloudTasks';
import { errorResponse, json } from '@/lib/http';
import { dispatchModelingJob } from '@/lib/modelingDispatch';
import {
  createModelingJob,
  deleteModelingSourceImages,
  getModelingJob,
  getPlant,
  saveModelingSourceImages,
  transitionModelingJob
} from '@/lib/repositories';

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
  let job;
  let created = false;
  try {
    const user = await requireUser(request);
    const useTasks = cloudTasksEnabled();
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

    const createdJob = await createModelingJob({
      plantId,
      observedAt: new Date(observedAt).toISOString(),
      submissionKey,
      user
    });
    job = createdJob.job;
    created = createdJob.created;
    if (!created) return json({ job, replayed: true }, 200);
    const images = { front: await imageData(front), right: await imageData(right) };
    if (useTasks) {
      await saveModelingSourceImages(job.id, images);
      await enqueueModelingDispatch(job.id);
      return json({ job }, 202);
    }

    await dispatchModelingJob(job, images);
    job = await transitionModelingJob(job.id, ['queued', 'dispatching', 'processing'], {
      status: 'processing',
      error: null
    }) || job;
    return json({ job }, 202);
  } catch (error) {
    if (job && created) {
      await transitionModelingJob(job.id, ['queued', 'dispatching', 'processing'], {
        status: 'failed',
        error: error.message
      }).catch(() => {});
      const storedJob = await getModelingJob(job.id).catch(() => null);
      if (storedJob) await deleteModelingSourceImages(storedJob).catch(() => {});
    }
    return errorResponse(error);
  }
}
