import assert from 'node:assert/strict';
import test from 'node:test';

import { modelingResultSchema } from '../src/lib/validation.js';

function successResult() {
  return {
    status: 'succeeded',
    plantId: 'A-1-1',
    observedAt: '2026-07-21T10:33:23.000Z',
    height: 170,
    nodes: 12,
    internodeStatistics: {
      overall: { count: 0, mean: null, standard_deviation: null, minimum: null, maximum: null },
      internodes_1_to_9: { count: 0, mean: null, standard_deviation: null, minimum: null, maximum: null },
      internodes_10_to_15: { count: 0, mean: null, standard_deviation: null, minimum: null, maximum: null },
      internodes_16_and_above: { count: 0, mean: null, standard_deviation: null, minimum: null, maximum: null }
    },
    gifUrl: null,
    glbUrl: 'https://storage.googleapis.com/private/job/model.glb',
    annotatedGlbUrl: 'https://storage.googleapis.com/public/job/annotated.glb',
    measurementUrl: 'https://storage.googleapis.com/private/job/measurements.json',
    nodesCsvUrl: 'https://storage.googleapis.com/private/job/nodes.csv'
  };
}

test('accepts trusted calibration audit fields on completion', () => {
  const payload = successResult();
  payload.internodeStatistics.internodes = [{
    internode_id: 1,
    from_node_id: 1,
    to_node_id: 2,
    length: 23.60977818777858
  }];
  const result = modelingResultSchema.parse({
    ...payload,
    calibrationProfile: 'robot_camera',
    modelToCmScale: 174.1084
  });
  assert.equal(result.calibrationProfile, 'robot_camera');
  assert.equal(result.modelToCmScale, 174.1084);
  assert.equal('internodes' in result.internodeStatistics, false);
});

test('requires calibration profile and coefficient together', () => {
  assert.equal(modelingResultSchema.safeParse({
    ...successResult(),
    calibrationProfile: 'robot_camera'
  }).success, false);
  assert.equal(modelingResultSchema.safeParse({
    ...successResult(),
    modelToCmScale: 174.1084
  }).success, false);
});
