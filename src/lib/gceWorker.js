import { GoogleAuth } from 'google-auth-library';

const COMPUTE_SCOPE = 'https://www.googleapis.com/auth/compute';

function config() {
  const values = {
    project: process.env.HUNYUAN_GCE_PROJECT,
    zone: process.env.HUNYUAN_GCE_ZONE,
    instance: process.env.HUNYUAN_GCE_INSTANCE
  };
  const configured = Object.values(values).filter(Boolean).length;
  if (!configured) return null;
  if (configured !== Object.keys(values).length) {
    throw new Error('HUNYUAN_GCE_PROJECT, HUNYUAN_GCE_ZONE, and HUNYUAN_GCE_INSTANCE must be set together');
  }
  return values;
}

function instanceUrl({ project, zone, instance }) {
  return `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(project)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(instance)}`;
}

async function workerReady() {
  const serviceUrl = process.env.HUNYUAN_SERVICE_URL;
  if (!serviceUrl) throw new Error('Missing HUNYUAN_SERVICE_URL');
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(Number(process.env.HUNYUAN_HEALTH_TIMEOUT_MS || 5000))
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.ready === true
      && body.configuration?.analyzer === true
      && body.activity?.state !== 'draining';
  } catch {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function ensureHunyuanWorkerReady() {
  const gce = config();
  if (!gce) return;

  const auth = new GoogleAuth({ scopes: [COMPUTE_SCOPE] });
  const client = await auth.getClient();
  const url = instanceUrl(gce);
  const timeout = Number(process.env.HUNYUAN_WAKE_TIMEOUT_MS || 240000);
  const interval = Number(process.env.HUNYUAN_WAKE_POLL_MS || 3000);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const response = await client.request({ url });
    const status = response.data?.status;

    if (status === 'RUNNING') {
      if (await workerReady()) return;
    } else if (status === 'SUSPENDED') {
      try {
        await client.request({ method: 'POST', url: `${url}/resume` });
      } catch (error) {
        // Another task can win the same resume race. Re-read the instance state.
        if (![400, 409].includes(error.response?.status)) throw error;
      }
    } else if (status === 'TERMINATED' || status === 'STOPPED') {
      throw new Error(
        `Hunyuan GCE worker is ${status}; start it and log in to Windows before retrying`
      );
    }

    await wait(Math.max(500, interval));
  }

  throw new Error(`Hunyuan GCE worker did not become ready within ${timeout} ms`);
}
