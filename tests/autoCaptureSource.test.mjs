import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureAssetUrl,
  findCompleteCapturePair,
  parseCapturePath
} from '../src/lib/autoCaptureSource.js';

test('maps pos2 to front and pos1 to right using the later Taipei timestamp', () => {
  const pair = findCompleteCapturePair([
    'images/tm_capture_20260721_183323_pos2.jpg',
    'images/tm_capture_20260721_183233_pos1.jpg'
  ]);

  assert.equal(pair.frontPath, 'images/tm_capture_20260721_183323_pos2.jpg');
  assert.equal(pair.rightPath, 'images/tm_capture_20260721_183233_pos1.jpg');
  assert.equal(pair.observedAt, '2026-07-21T10:33:23.000Z');
  assert.match(pair.fingerprint, /^[a-f0-9]{64}$/);
});

test('waits until exactly one valid pos1 and pos2 are present', () => {
  assert.equal(findCompleteCapturePair([
    'images/tm_capture_20260721_183233_pos1.jpg'
  ]), null);
  assert.equal(findCompleteCapturePair([
    'images/tm_capture_20260721_183233_pos1.jpg',
    'images/tm_capture_20260721_183323_pos2.jpg',
    'images/unexpected.jpg'
  ]), null);
  assert.equal(findCompleteCapturePair([
    'images/tm_capture_20260721_180000_pos1.jpg',
    'images/tm_capture_20260721_183323_pos2.jpg'
  ]), null);
});

test('rejects invalid dates and resolves image paths against images.json', () => {
  assert.equal(parseCapturePath('images/tm_capture_20260230_183233_pos1.jpg'), null);
  assert.equal(
    captureAssetUrl('https://example.com/folder/images.json', 'images/photo.jpg'),
    'https://example.com/folder/images/photo.jpg'
  );
});
