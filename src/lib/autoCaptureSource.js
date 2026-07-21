import { createHash } from 'crypto';

const CAPTURE_PATTERN = /(?:^|\/)tm_capture_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(pos[12])\.(jpe?g|png)$/i;

function captureTimestamp(match, offsetMinutes) {
  const [, year, month, day, hour, minute, second] = match;
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ) - offsetMinutes * 60 * 1000;
  const localCheck = new Date(utc + offsetMinutes * 60 * 1000);
  if (
    localCheck.getUTCFullYear() !== Number(year)
    || localCheck.getUTCMonth() + 1 !== Number(month)
    || localCheck.getUTCDate() !== Number(day)
    || localCheck.getUTCHours() !== Number(hour)
    || localCheck.getUTCMinutes() !== Number(minute)
    || localCheck.getUTCSeconds() !== Number(second)
  ) return null;
  return utc;
}

export function parseCapturePath(path, offsetMinutes = 480) {
  if (typeof path !== 'string') return null;
  const normalized = path.trim().replaceAll('\\', '/');
  const match = normalized.match(CAPTURE_PATTERN);
  if (!match) return null;
  const timestamp = captureTimestamp(match, offsetMinutes);
  if (timestamp === null) return null;
  return { path: normalized, position: match[7].toLowerCase(), timestamp };
}

export function findCompleteCapturePair(files, options = {}) {
  if (!Array.isArray(files)) return null;
  const offsetMinutes = options.offsetMinutes ?? 480;
  const maxGapMs = options.maxGapMs ?? 5 * 60 * 1000;
  const captures = files.map(path => parseCapturePath(path, offsetMinutes)).filter(Boolean);
  if (files.length !== 2 || captures.length !== 2) return null;
  const pos1 = captures.find(capture => capture.position === 'pos1');
  const pos2 = captures.find(capture => capture.position === 'pos2');
  if (!pos1 || !pos2 || Math.abs(pos1.timestamp - pos2.timestamp) > maxGapMs) return null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([pos1.path, pos2.path]))
    .digest('hex');
  return {
    fingerprint,
    frontPath: pos2.path,
    rightPath: pos1.path,
    observedAt: new Date(Math.max(pos1.timestamp, pos2.timestamp)).toISOString()
  };
}

export function captureAssetUrl(sourceUrl, path) {
  return new URL(path, sourceUrl).toString();
}
