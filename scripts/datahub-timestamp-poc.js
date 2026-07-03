#!/usr/bin/env node
'use strict';

const {
  EdgeAgent,
  EdgeData,
  EdgeDataTag,
  constant
} = require('wisepaas-datahub-edge-nodejs-sdk');

const DEFAULT_NODE_ID = 'fac73565-5615-4af0-9bd9-2350ddb621cb';
const DEFAULT_DCCS_API_URL = 'https://api-dccs-ensaas.education.wise-paas.com/';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readNumberEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number. Received: ${raw}`);
  }
  return value;
}

function makeTag(deviceId, tagName, value) {
  const tag = new EdgeDataTag();
  tag.deviceId = deviceId;
  tag.tagName = tagName;
  tag.value = value;
  return tag;
}

function waitForEvent(agent, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for SDK event: ${eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      agent.events.removeListener(eventName, onEvent);
    }

    function onEvent() {
      cleanup();
      resolve();
    }

    agent.events.once(eventName, onEvent);
  });
}

async function main() {
  const nodeId = process.env.DATAHUB_NODE_ID || DEFAULT_NODE_ID;
  const apiUrl = process.env.DATAHUB_DCCS_API_URL || DEFAULT_DCCS_API_URL;
  const credentialKey = requiredEnv('DATAHUB_DCCS_CREDENTIAL_KEY');
  const plantId = process.env.POC_PLANT_ID || 'A-1-1';
  const observedAt = process.env.POC_OBSERVED_AT || '2024-07-30T00:00:00+08:00';
  const height = readNumberEnv('POC_HEIGHT', 158);
  const nodes = readNumberEnv('POC_NODES', 33);
  const connectTimeoutMs = readNumberEnv('POC_CONNECT_TIMEOUT_MS', 30000);
  const publishWaitMs = readNumberEnv('POC_PUBLISH_WAIT_MS', 3000);
  const timestampMs = new Date(observedAt).getTime();

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid POC_OBSERVED_AT: ${observedAt}`);
  }

  const agent = new EdgeAgent({
    nodeId,
    type: constant.edgeType.Gateway,
    connectType: constant.connectType.DCCS,
    autoReconnect: false,
    dataRecover: false,
    DCCS: {
      credentialKey,
      APIUrl: apiUrl
    }
  });

  const data = new EdgeData();
  data.ts = timestampMs;
  data.tagList.push(makeTag(plantId, 'height', height));
  data.tagList.push(makeTag(plantId, 'nodes', nodes));
  data.tagList.push(makeTag(plantId, 'plant', plantId));

  console.log('DataHub timestamp PoC');
  console.log(JSON.stringify({
    nodeId,
    plantId,
    observedAt,
    timestampMs,
    tags: {
      height,
      nodes,
      plant: plantId
    }
  }, null, 2));

  const connected = waitForEvent(agent, 'connected', connectTimeoutMs);
  await agent.connect();
  await connected;

  await agent.sendData(data);
  console.log('sendData completed. Check DataHub history for the timestamp above.');

  await new Promise(resolve => setTimeout(resolve, publishWaitMs));
  await agent.disconnect().catch(error => {
    console.warn(`disconnect warning: ${error.message}`);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
