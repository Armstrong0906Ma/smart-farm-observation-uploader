export async function dispatchModelingJob(job, images) {
  const serviceUrl = process.env.HUNYUAN_SERVICE_URL;
  if (!serviceUrl) throw new Error('Missing HUNYUAN_SERVICE_URL');
  const workerForm = new FormData();
  workerForm.set('job_id', job.id);
  workerForm.set('plant_id', job.plantId);
  workerForm.set('observed_at', job.observedAt);
  workerForm.set('front', new Blob([images.front.buffer], { type: images.front.type }), images.front.name);
  workerForm.set('right', new Blob([images.right.buffer], { type: images.right.type }), images.right.name);
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/capture-complete/upload`, {
    method: 'POST',
    headers: process.env.HUNYUAN_SERVICE_TOKEN
      ? { Authorization: `Bearer ${process.env.HUNYUAN_SERVICE_TOKEN}` }
      : {},
    body: workerForm,
    cache: 'no-store'
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hunyuan worker rejected the job (${response.status}): ${detail}`);
  }
}
