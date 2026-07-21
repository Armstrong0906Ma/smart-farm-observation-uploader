export class ModelingDispatchError extends Error {
  constructor(message, workerStatus = null) {
    super(message);
    this.name = 'ModelingDispatchError';
    this.workerStatus = workerStatus;
  }

  get terminal() {
    return this.workerStatus !== null
      && this.workerStatus >= 400
      && this.workerStatus < 500
      && ![408, 409, 425, 429].includes(this.workerStatus);
  }
}

export function calibrationProfileForJob(job) {
  return job?.submissionSource === 'robot_camera' ? 'robot_camera' : 'manual';
}

export async function dispatchModelingJob(job, images) {
  const serviceUrl = process.env.HUNYUAN_SERVICE_URL;
  if (!serviceUrl) throw new ModelingDispatchError('Missing HUNYUAN_SERVICE_URL');
  const workerForm = new FormData();
  workerForm.set('job_id', job.id);
  workerForm.set('plant_id', job.plantId);
  workerForm.set('observed_at', job.observedAt);
  workerForm.set('calibration_profile', calibrationProfileForJob(job));
  workerForm.set('front', new Blob([images.front.buffer], { type: images.front.type }), images.front.name);
  workerForm.set('right', new Blob([images.right.buffer], { type: images.right.type }), images.right.name);
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/capture-complete/upload`, {
    method: 'POST',
    headers: process.env.HUNYUAN_SERVICE_TOKEN
      ? { Authorization: `Bearer ${process.env.HUNYUAN_SERVICE_TOKEN}` }
      : {},
    body: workerForm,
    cache: 'no-store',
    signal: AbortSignal.timeout(Number(process.env.HUNYUAN_DISPATCH_TIMEOUT_MS || 120000))
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ModelingDispatchError(
      `Hunyuan worker rejected the job (${response.status}): ${detail}`,
      response.status
    );
  }
}
