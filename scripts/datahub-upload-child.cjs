const DEFAULT_NODE_ID = 'fac73565-5615-4af0-9bd9-2350ddb621cb';
const DEFAULT_DCCS_API_URL = 'https://api-dccs-ensaas.education.wise-paas.com/';

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.once('error', reject);
  });
}

function waitForEvent(agent, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      agent.events.removeListener(eventName, onEvent);
      reject(new Error(`Timed out waiting for SDK event: ${eventName}`));
    }, timeoutMs);
    function onEvent() {
      clearTimeout(timer);
      resolve();
    }
    agent.events.once(eventName, onEvent);
  });
}

function makeTag(EdgeDataTag, observation, tagName, value) {
  const tag = new EdgeDataTag();
  tag.deviceId = observation.plantId;
  tag.tagName = tagName;
  tag.value = value;
  return tag;
}

async function main() {
  const credentialKey = process.env.DATAHUB_DCCS_CREDENTIAL_KEY;
  if (!credentialKey) throw new Error('Missing DATAHUB_DCCS_CREDENTIAL_KEY');
  const observation = JSON.parse(await readStdin());
  const timestampMs = new Date(observation.observedAt).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error('Invalid observation observedAt');
  const { EdgeAgent, EdgeData, EdgeDataTag, constant } = require('wisepaas-datahub-edge-nodejs-sdk');
  const agent = new EdgeAgent({
    nodeId: process.env.DATAHUB_NODE_ID || DEFAULT_NODE_ID,
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
  data.tagList.push(makeTag(EdgeDataTag, observation, 'height', observation.height));
  data.tagList.push(makeTag(EdgeDataTag, observation, 'nodes', observation.nodes));
  data.tagList.push(makeTag(EdgeDataTag, observation, 'plant', observation.plantId));
  if (observation.gifUrl) data.tagList.push(makeTag(EdgeDataTag, observation, 'gif_url', observation.gifUrl));

  try {
    const connected = waitForEvent(agent, 'connected', Number(process.env.DATAHUB_CONNECT_TIMEOUT_MS || 30000));
    await agent.connect();
    await connected;
    await agent.sendData(data);
    await new Promise(resolve => setTimeout(resolve, Number(process.env.DATAHUB_PUBLISH_WAIT_MS || 1500)));
  } finally {
    await agent.disconnect().catch(() => {});
  }
  process.stdout.write(JSON.stringify({ adapter: 'datahub-node-sdk', timestampMs }));
}

main().catch(error => {
  process.stderr.write(error.message || String(error));
  process.exitCode = 1;
});
