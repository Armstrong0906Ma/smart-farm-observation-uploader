#!/usr/bin/env node
'use strict';

const { loadEnvConfig } = require('@next/env');
const { Storage } = require('@google-cloud/storage');
const { MongoClient } = require('mongodb');

loadEnvConfig(process.cwd());

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseGcsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('URL is not HTTPS');
  if (url.hostname === 'storage.googleapis.com') {
    const [bucket, ...objectParts] = url.pathname.slice(1).split('/');
    return { bucket, object: decodeURIComponent(objectParts.join('/')) };
  }
  if (url.hostname.endsWith('.storage.googleapis.com')) {
    return {
      bucket: url.hostname.slice(0, -'.storage.googleapis.com'.length),
      object: decodeURIComponent(url.pathname.slice(1))
    };
  }
  throw new Error('URL is not a GCS object URL');
}

function publicUrl(bucket, object) {
  const encodedObject = object.split('/').map(encodeURIComponent).join('/');
  return `https://storage.googleapis.com/${bucket}/${encodedObject}`;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const sourceBucketName = requiredEnv('PRIVATE_GCS_BUCKET');
  const publicBucketName = requiredEnv('PUBLIC_GCS_BUCKET');
  if (sourceBucketName === publicBucketName) throw new Error('Source and public buckets must differ');

  const client = new MongoClient(requiredEnv('MONGODB_URI'));
  const storage = new Storage();
  await client.connect();
  try {
    const database = client.db(process.env.MONGODB_DATABASE || 'smart_farm');
    const observations = database.collection('observations');
    const modelingJobs = database.collection('modelingJobs');
    const cursor = observations.find({
      source: 'robot_vision',
      annotatedGlbUrl: { $type: 'string' },
      modelingJobId: { $type: 'string' }
    });
    let eligible = 0;
    let migrated = 0;
    let skipped = 0;

    for await (const observation of cursor) {
      const job = await modelingJobs.findOne({ _id: observation.modelingJobId });
      if (!job || job.status !== 'succeeded') {
        skipped += 1;
        continue;
      }

      let location;
      try {
        location = parseGcsUrl(observation.annotatedGlbUrl);
      } catch (error) {
        console.warn(`Skipping observation ${observation._id}: ${error.message}`);
        skipped += 1;
        continue;
      }
      if (![sourceBucketName, publicBucketName].includes(location.bucket) || !location.object) {
        skipped += 1;
        continue;
      }

      eligible += 1;
      const destinationUrl = publicUrl(publicBucketName, location.object);
      console.log(`${execute ? 'MIGRATE' : 'PLAN'} ${observation._id}: ${destinationUrl}`);
      if (!execute) continue;

      const destinationFile = storage.bucket(publicBucketName).file(location.object);
      const sourceFile = storage.bucket(sourceBucketName).file(location.object);
      const [sourceExists] = await sourceFile.exists();
      if (!sourceExists) throw new Error(`Source object is missing: gs://${sourceBucketName}/${location.object}`);
      const [destinationExists] = await destinationFile.exists();
      if (!destinationExists) {
        await sourceFile.copy(destinationFile);
      }
      const [[sourceMetadata], [destinationMetadata]] = await Promise.all([
        sourceFile.getMetadata(),
        destinationFile.getMetadata()
      ]);
      if (sourceMetadata.size !== destinationMetadata.size
        || sourceMetadata.crc32c !== destinationMetadata.crc32c) {
        throw new Error(`Destination object does not match source: gs://${publicBucketName}/${location.object}`);
      }
      await destinationFile.setMetadata({
        contentType: 'model/gltf-binary',
        contentDisposition: 'attachment; filename="annotated.glb"'
      });

      const updatedAt = new Date().toISOString();
      await observations.updateOne(
        { _id: observation._id },
        { $set: { annotatedGlbUrl: destinationUrl, updatedAt } }
      );
      const jobUpdate = { updatedAt };
      if (job.completionResult?.status === 'succeeded') {
        jobUpdate['completionResult.annotatedGlbUrl'] = destinationUrl;
      }
      await modelingJobs.updateOne({ _id: job._id, status: 'succeeded' }, { $set: jobUpdate });
      migrated += 1;
    }

    console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', eligible, migrated, skipped }));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
