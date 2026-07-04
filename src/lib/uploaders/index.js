import { uploadManyWithDataHubNodeSdk, uploadWithDataHubNodeSdk } from '@/lib/uploaders/nodeSdkUploader';

async function mockUpload(observation) {
  return {
    adapter: 'mock',
    remoteId: `${observation.plantId}:${observation.observedAt}`
  };
}

export async function uploadObservation(observation) {
  const uploader = process.env.DATAHUB_UPLOADER || 'mock';

  if (uploader === 'mock') return mockUpload(observation);
  if (uploader === 'datahub-node-sdk') return uploadWithDataHubNodeSdk(observation);

  throw new Error(`Unsupported DATAHUB_UPLOADER: ${uploader}`);
}

export async function uploadObservations(observations, options = {}) {
  const uploader = process.env.DATAHUB_UPLOADER || 'mock';

  if (uploader === 'mock') {
    const results = observations.map((observation, index) => ({
      index,
      adapter: 'mock',
      status: 'uploaded',
      remoteId: `${observation.plantId}:${observation.observedAt}`
    }));
    if (options.onResult) {
      for (const result of results) await options.onResult(result);
    }
    return results;
  }

  if (uploader === 'datahub-node-sdk') return uploadManyWithDataHubNodeSdk(observations, options);

  throw new Error(`Unsupported DATAHUB_UPLOADER: ${uploader}`);
}
