import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calibrationProfileForJob,
  dispatchModelingJob
} from '../src/lib/modelingDispatch.js';

test('maps only trusted robot-camera jobs to the robot calibration profile', () => {
  assert.equal(calibrationProfileForJob({ submissionSource: 'robot_camera' }), 'robot_camera');
  assert.equal(calibrationProfileForJob({ submissionSource: 'manual' }), 'manual');
  assert.equal(calibrationProfileForJob({}), 'manual');
});

test('dispatches calibration profile without accepting a numeric scale', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.HUNYUAN_SERVICE_URL;
  let submitted;
  process.env.HUNYUAN_SERVICE_URL = 'https://worker.example.com';
  globalThis.fetch = async (_url, options) => {
    submitted = options.body;
    return new Response('{}', { status: 202 });
  };
  try {
    await dispatchModelingJob({
      id: 'job-1',
      plantId: 'A-1-1',
      observedAt: '2026-07-21T10:33:23.000Z',
      submissionSource: 'robot_camera'
    }, {
      front: { buffer: Buffer.from('front'), type: 'image/jpeg', name: 'front.jpg' },
      right: { buffer: Buffer.from('right'), type: 'image/jpeg', name: 'right.jpg' }
    });
    assert.equal(submitted.get('calibration_profile'), 'robot_camera');
    assert.equal(submitted.has('model_to_cm_scale'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.HUNYUAN_SERVICE_URL;
    else process.env.HUNYUAN_SERVICE_URL = originalUrl;
  }
});
