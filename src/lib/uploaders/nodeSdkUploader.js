import { spawn } from 'child_process';
import path from 'path';

function runUploader(observation) {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), 'scripts', 'datahub-upload-child.cjs');
    const child = spawn(process.execPath, [script], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `DataHub upload process exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('DataHub upload process returned an invalid response'));
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
