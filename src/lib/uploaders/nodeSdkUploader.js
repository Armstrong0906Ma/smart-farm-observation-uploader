const DEFAULT_NODE_ID = 'fac73565-5615-4af0-9bd9-2350ddb621cb';
const DEFAULT_DCCS_API_URL = 'https://api-dccs-ensaas.education.wise-paas.com/';

function makeTag(EdgeDataTag, deviceId, tagName, value) {
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

export async function uploadWithDataHubNodeSdk(observation) {
  const credentialKey = process.env.DATAHUB_DCCS_CREDENTIAL_KEY;
  if (!credentialKey) throw new Error('Missing DATAHUB_DCCS_CREDENTIAL_KEY');

  // The SDK mutates NODE_TLS_REJECT_UNAUTHORIZED when imported, so load it only for real uploads.
  const { EdgeAgent, EdgeData, EdgeDataTag, constant } = await import('wisepaas-datahub-edge-nodejs-sdk');
  const nodeId = process.env.DATAHUB_NODE_ID || DEFAULT_NODE_ID;
  const timestampMs = new Date(observation.observedAt).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error('Invalid observation observedAt');

  const agent = new EdgeAgent({
    nodeId,
    type: constant.edgeType.Gateway,
    connectType: constant.connectType.DCCS,
    autoReconnect: false,
    dataRecover: false,
    DCCS: {
      credentialKey,
      APIUrl: process.env.DATAHUB_DCCS_API_URL || DEFAULT_DCCS_API_URL
    }
  });

  const data = new EdgeData();
  data.ts = timestampMs;
  data.tagList.push(makeTag(EdgeDataTag, observation.plantId, 'height', observation.height));
  data.tagList.push(makeTag(EdgeDataTag, observation.plantId, 'nodes', observation.nodes));
  data.tagList.push(makeTag(EdgeDataTag, observation.plantId, 'plant', observation.plantId));

  const connected = waitForEvent(agent, 'connected', Number(process.env.DATAHUB_CONNECT_TIMEOUT_MS || 30000));
  await agent.connect();
  await connected;
  await agent.sendData(data);
  await new Promise(resolve => setTimeout(resolve, Number(process.env.DATAHUB_PUBLISH_WAIT_MS || 1500)));
  await agent.disconnect().catch(() => {});

  return { adapter: 'datahub-node-sdk', timestampMs };
}
