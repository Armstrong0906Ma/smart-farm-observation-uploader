import { spawn } from 'child_process';
import path from 'path';

const CHILD_ENV_KEYS = [
  'DATAHUB_DCCS_CREDENTIAL_KEY',
  'DATAHUB_NODE_ID',
  'DATAHUB_DCCS_API_URL',
  'DATAHUB_CONNECT_TIMEOUT_MS',
  'DATAHUB_PUBLISH_WAIT_MS',
  'HOME',
  'NODE_ENV',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'WINDIR'
];

function childEnv() {
  return Object.fromEntries(CHILD_ENV_KEYS
    .filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]));
}

function positiveSetting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function runUploader(observation) {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'datahub-upload-child.cjs');
    const child = spawn(process.execPath, [script], {
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const timeoutMs = positiveSetting('DATAHUB_PROCESS_TIMEOUT_MS', 60_000);
    const outputLimit = positiveSetting('DATAHUB_PROCESS_OUTPUT_LIMIT_BYTES', 64 * 1024);
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`DataHub upload process timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const capture = (target, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > outputLimit) {
        child.kill();
        finish(reject, new Error(`DataHub upload process exceeded ${outputLimit} output bytes`));
        return target;
      }
      return target + chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = capture(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = capture(stderr, chunk); });
    child.once('error', error => finish(reject, error));
    child.stdin.once('error', error => finish(reject, error));
    child.once('close', code => {
      if (code !== 0) {
        finish(reject, new Error(stderr.trim() || `DataHub upload process exited with code ${code}`));
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout));
      } catch {
        finish(reject, new Error('DataHub upload process returned an invalid response'));
      }
    });
    child.stdin.end(JSON.stringify(observation));
  });
}

export function uploadWithDataHubNodeSdk(observation) {
  return runUploader(observation);
}

export async function uploadManyWithDataHubNodeSdk(observations, { onResult } = {}) {
  const results = [];
  for (const [index, observation] of observations.entries()) {
    try {
      const result = await runUploader(observation);
      const item = { index, ...result, status: 'uploaded' };
      results.push(item);
      if (onResult) await onResult(item);
    } catch (error) {
      const item = { index, adapter: 'datahub-node-sdk', status: 'failed', error: error.message };
      results.push(item);
      if (onResult) await onResult(item);
    }
  }
  return results;
}
