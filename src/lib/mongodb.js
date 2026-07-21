import { MongoClient } from 'mongodb';

const globalForMongo = globalThis;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');

  if (!globalForMongo.mongoClientPromise) {
    const client = new MongoClient(uri);
    globalForMongo.mongoClientPromise = client.connect();
  }

  return globalForMongo.mongoClientPromise;
}

export async function getDatabase() {
  const client = await getClient();
  const database = client.db(process.env.MONGODB_DATABASE || 'smart_farm');

  if (!globalForMongo.mongoIndexesPromise) {
    globalForMongo.mongoIndexesPromise = database.collection('observations')
      .updateMany({ modelingJobId: null }, { $unset: { modelingJobId: '' } })
      .then(() => Promise.all([
      database.collection('observations').createIndex({ plantId: 1, observedAt: 1 }, { unique: true }),
      database.collection('observations').createIndex({ modelingJobId: 1 }, { unique: true, sparse: true }),
      database.collection('observations').createIndex({ uploadStatus: 1, observedAt: 1 }),
      database.collection('observations').createIndex({ plantId: 1, observedAt: -1, dashboardStatus: 1 }),
      database.collection('importBatchItems').createIndex({ batchId: 1, index: 1 }, { unique: true }),
      database.collection('importBatches').createIndex({ createdAt: -1 }),
      database.collection('modelingJobs').createIndex({ createdAt: -1 }),
      database.collection('modelingJobs').createIndex({ status: 1, createdAt: 1 }),
      database.collection('modelingJobs').createIndex(
        { createdBy: 1, submissionKey: 1 },
        { unique: true, partialFilterExpression: { submissionKey: { $type: 'string' } } }
      ),
      database.collection('autoCapturePairs').createIndex({ status: 1, createdAt: 1 })
      ]));
  }

  await globalForMongo.mongoIndexesPromise;
  return database;
}
