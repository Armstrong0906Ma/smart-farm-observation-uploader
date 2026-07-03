import { uploadWithDataHubNodeSdk } from '@/lib/uploaders/nodeSdkUploader';

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
