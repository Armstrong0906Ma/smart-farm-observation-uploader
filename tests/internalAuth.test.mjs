import assert from 'node:assert/strict';
import test from 'node:test';

import { requireInternalToken } from '../src/lib/internalAuth.js';

function requestWith(headers = {}) {
  return new Request('https://example.com', { headers });
}

test('accepts the internal task token from the robot header', () => {
  const previous = process.env.INTERNAL_TASK_TOKEN;
  process.env.INTERNAL_TASK_TOKEN = 'test-internal-token';
  try {
    assert.doesNotThrow(() => requireInternalToken(requestWith({
      'X-Internal-Task-Token': 'test-internal-token'
    })));
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_TASK_TOKEN;
    else process.env.INTERNAL_TASK_TOKEN = previous;
  }
});

test('accepts the internal task token as a bearer token', () => {
  const previous = process.env.INTERNAL_TASK_TOKEN;
  process.env.INTERNAL_TASK_TOKEN = 'test-internal-token';
  try {
    assert.doesNotThrow(() => requireInternalToken(requestWith({
      Authorization: 'Bearer test-internal-token'
    })));
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_TASK_TOKEN;
    else process.env.INTERNAL_TASK_TOKEN = previous;
  }
});

test('rejects missing, incorrect, or unconfigured internal tokens', () => {
  const previous = process.env.INTERNAL_TASK_TOKEN;
  try {
    process.env.INTERNAL_TASK_TOKEN = 'test-internal-token';
    assert.throws(() => requireInternalToken(requestWith()), /Unauthorized internal task/);
    assert.throws(() => requireInternalToken(requestWith({
      'X-Internal-Task-Token': 'wrong-token'
    })), /Unauthorized internal task/);

    delete process.env.INTERNAL_TASK_TOKEN;
    assert.throws(() => requireInternalToken(requestWith({
      'X-Internal-Task-Token': 'undefined'
    })), /Unauthorized internal task/);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_TASK_TOKEN;
    else process.env.INTERNAL_TASK_TOKEN = previous;
  }
});
