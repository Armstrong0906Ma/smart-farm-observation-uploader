import { CloudTasksClient } from '@google-cloud/tasks';

let client;

function config() {
  const values = {
    project: process.env.TASKS_PROJECT_ID,
    location: process.env.TASKS_LOCATION,
    queue: process.env.TASKS_QUEUE,
    handlerUrl: process.env.TASK_HANDLER_URL,
    token: process.env.INTERNAL_TASK_TOKEN,
    serviceAccountEmail: process.env.TASK_SERVICE_ACCOUNT_EMAIL || null
  };
  const required = ['project', 'location', 'queue', 'handlerUrl', 'token'];
  const configured = required.filter(key => values[key]).length;
  if (configured === 0) return null;
  if (configured !== required.length) {
    throw new Error('Cloud Tasks requires TASKS_PROJECT_ID, TASKS_LOCATION, TASKS_QUEUE, TASK_HANDLER_URL, and INTERNAL_TASK_TOKEN');
  }
  return values;
}

export function cloudTasksEnabled() {
  return Boolean(config());
}

async function enqueue(kind, id, path, payload) {
  const settings = config();
  if (!settings) return false;
  client ||= new CloudTasksClient();
  const parent = client.queuePath(settings.project, settings.location, settings.queue);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const headers = { 'Content-Type': 'application/json' };
  if (settings.serviceAccountEmail) headers['X-Internal-Task-Token'] = settings.token;
  else headers.Authorization = `Bearer ${settings.token}`;
  const httpRequest = {
    httpMethod: 'POST',
    url: `${settings.handlerUrl.replace(/\/$/, '')}${path}`,
    headers,
    body: Buffer.from(JSON.stringify(payload)).toString('base64')
  };
  if (settings.serviceAccountEmail) {
    httpRequest.oidcToken = {
      serviceAccountEmail: settings.serviceAccountEmail,
      audience: settings.handlerUrl.replace(/\/$/, '')
    };
  }
  const task = {
    name: client.taskPath(settings.project, settings.location, settings.queue, `${kind}-${safeId}`),
    httpRequest
  };
  try {
    await client.createTask({ parent, task });
  } catch (error) {
    if (error.code !== 6) throw error;
  }
  return true;
}

export function enqueueModelingDispatch(jobId) {
  return enqueue('modeling', jobId, '/api/internal/tasks/modeling-dispatch', { jobId });
}

export function enqueueDataHubPublish(observationId) {
  return enqueue('datahub', observationId, '/api/internal/tasks/datahub-publish', { observationId });
}
