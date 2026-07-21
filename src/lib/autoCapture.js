import { captureAssetUrl, findCompleteCapturePair } from '@/lib/autoCaptureSource';
import { cloudTasksEnabled } from '@/lib/cloudTasks';
import { submitModelingJob } from '@/lib/modelingSubmission';
import {
  claimAutoCapturePair,
  getPlant,
  initializeAutoCapture,
  markAutoCapturePairError,
  markAutoCapturePairSubmitted,
  recordAutoCapturePair
} from '@/lib/repositories';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

function settings() {
  const enabled = process.env.AUTO_CAPTURE_ENABLED === 'true';
  const sourceUrl = process.env.AUTO_CAPTURE_SOURCE_URL;
  const plantId = (process.env.AUTO_CAPTURE_PLANT_ID || 'A-1-1').trim();
  const timezone = process.env.AUTO_CAPTURE_TIMEZONE || 'Asia/Taipei';
  if (!enabled) return { enabled: false };
  if (!sourceUrl) throw new Error('AUTO_CAPTURE_SOURCE_URL is required when auto capture is enabled');
  if (timezone !== 'Asia/Taipei') throw new Error('AUTO_CAPTURE_TIMEZONE currently supports only Asia/Taipei');
  return { enabled, sourceUrl, plantId };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Auto-capture source returned HTTP ${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error('Auto-capture images.json must be an array');
  return value;
}

async function fetchImage(url, view) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${view} image returned HTTP ${response.status}`);
  const type = response.headers.get('content-type')?.split(';')[0] || '';
  if (!type.startsWith('image/')) throw new Error(`${view} source is not an image`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error(`${view} image exceeds 15 MB`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`${view} image is empty or exceeds 15 MB`);
  }
  return { buffer, name: new URL(url).pathname.split('/').pop() || `${view}.jpg`, type };
}

export async function pollAutoCaptureSource() {
  const config = settings();
  if (!config.enabled) return { status: 'disabled' };
  if (!cloudTasksEnabled()) throw new Error('Auto capture requires Cloud Tasks configuration');

  const plant = await getPlant(config.plantId);
  if (!plant?.enabled) throw new Error(`Auto-capture plant ${config.plantId} does not exist or is disabled`);
  const pair = findCompleteCapturePair(await fetchJson(config.sourceUrl));
  if (!pair) return { status: 'waiting_for_pair' };

  const initialization = await initializeAutoCapture(pair, config.plantId);
  if (initialization.baseline) return { status: 'baseline', fingerprint: pair.fingerprint };
  const record = await recordAutoCapturePair(pair, config.plantId);
  if (record?.status === 'submitted') {
    return { status: 'already_submitted', fingerprint: pair.fingerprint, jobId: record.jobId };
  }
  if (record?.status === 'baseline') return { status: 'baseline', fingerprint: pair.fingerprint };
  const claim = await claimAutoCapturePair(pair.fingerprint);
  if (!claim) return { status: 'already_processing', fingerprint: pair.fingerprint };

  try {
    const frontUrl = captureAssetUrl(config.sourceUrl, pair.frontPath);
    const rightUrl = captureAssetUrl(config.sourceUrl, pair.rightPath);
    const [front, right] = await Promise.all([
      fetchImage(frontUrl, 'front'),
      fetchImage(rightUrl, 'right')
    ]);
    const result = await submitModelingJob({
      plantId: config.plantId,
      observedAt: pair.observedAt,
      submissionKey: `robot-${pair.fingerprint.slice(0, 56)}`,
      user: { uid: 'automation:robot-camera' },
      images: { front, right },
      submissionSource: 'robot_camera',
      failOnPreparationError: false
    });
    await markAutoCapturePairSubmitted(pair.fingerprint, result.job.id);
    return {
      status: result.replayed ? 'already_submitted' : 'submitted',
      fingerprint: pair.fingerprint,
      jobId: result.job.id
    };
  } catch (error) {
    await markAutoCapturePairError(pair.fingerprint, error.message).catch(() => {});
    throw error;
  }
}
