import { randomUUID } from 'crypto';
import { GridFSBucket } from 'mongodb';
import { getDatabase } from '@/lib/mongodb';
import { defaultPlants } from '@/lib/plants';

function nowIso() {
  return new Date().toISOString();
}

function canModifyObservation(observation) {
  return observation.uploadStatus === 'pending' || observation.uploadStatus === 'failed';
}

function cleanDoc(doc) {
  if (!doc) return null;
  const { _id, ...data } = doc;
  return { id: String(_id), ...data };
}

function duplicateObservationError() {
  const error = new Error('同一植株與觀測時間已存在，請改用修改或重新上傳');
  error.status = 409;
  return error;
}

export async function ensureDefaultPlants() {
  const database = await getDatabase();
  const timestamp = nowIso();
  await database.collection('plants').bulkWrite(defaultPlants().map(plant => ({
    updateOne: {
      filter: { _id: plant.plantId },
      update: { $setOnInsert: { ...plant, createdAt: timestamp, updatedAt: timestamp } },
      upsert: true
    }
  })));
}

export async function listPlants() {
  await ensureDefaultPlants();
  const database = await getDatabase();
  const plants = await database.collection('plants').find({ enabled: true }).sort({ plantId: 1 }).toArray();
  return plants.map(cleanDoc);
}

export async function getPlant(plantId) {
  const database = await getDatabase();
  return cleanDoc(await database.collection('plants').findOne({ _id: plantId }));
}

export async function createObservation(input, user) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const observation = {
    _id: randomUUID(),
    plantId: input.plantId,
    observedAt: input.observedAt,
    height: input.height,
    nodes: input.nodes,
    internodeStatistics: input.internodeStatistics || null,
    gifUrl: input.gifUrl || null,
    glbUrl: input.glbUrl || null,
    annotatedGlbUrl: input.annotatedGlbUrl || null,
    measurementUrl: input.measurementUrl || null,
    source: input.source || 'manual',
    note: input.note || '',
    uploadStatus: 'pending',
    retryCount: 0,
    lastError: null,
    uploadedAt: null,
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  if (input.modelingJobId) observation.modelingJobId = input.modelingJobId;

  try {
    await database.collection('observations').insertOne(observation);
  } catch (error) {
    if (error.code === 11000) throw duplicateObservationError();
    throw error;
  }
  return cleanDoc(observation);
}

export async function getObservationByModelingJobId(modelingJobId) {
  const database = await getDatabase();
  return cleanDoc(await database.collection('observations').findOne({ modelingJobId }));
}

export async function getOrCreateObservationByModelingJobId(input, user) {
  if (!input.modelingJobId) throw new Error('modelingJobId is required');
  const database = await getDatabase();
  const timestamp = nowIso();
  const observation = {
    _id: randomUUID(),
    plantId: input.plantId,
    observedAt: input.observedAt,
    height: input.height,
    nodes: input.nodes,
    internodeStatistics: input.internodeStatistics || null,
    gifUrl: input.gifUrl || null,
    glbUrl: input.glbUrl || null,
    annotatedGlbUrl: input.annotatedGlbUrl || null,
    measurementUrl: input.measurementUrl || null,
    modelingJobId: input.modelingJobId,
    source: input.source || 'robot_vision',
    note: input.note || '',
    uploadStatus: 'pending',
    retryCount: 0,
    lastError: null,
    uploadedAt: null,
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  try {
    const result = await database.collection('observations').findOneAndUpdate(
      { modelingJobId: input.modelingJobId },
      { $setOnInsert: observation },
      { upsert: true, returnDocument: 'after' }
    );
    return cleanDoc(result);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await database.collection('observations').findOne({ modelingJobId: input.modelingJobId });
      if (existing) return cleanDoc(existing);
      throw duplicateObservationError();
    }
    throw error;
  }
}

export async function createModelingJob({ plantId, observedAt, user }) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const job = {
    _id: randomUUID(),
    plantId,
    observedAt,
    status: 'queued',
    dataHubStatus: null,
    error: null,
    observationId: null,
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await database.collection('modelingJobs').insertOne(job);
  return cleanDoc(job);
}

export async function getModelingJob(id) {
  const database = await getDatabase();
  return cleanDoc(await database.collection('modelingJobs').findOne({ _id: id }));
}

export async function updateModelingJob(id, patch) {
  const database = await getDatabase();
  const updated = await database.collection('modelingJobs').findOneAndUpdate(
    { _id: id },
    { $set: { ...patch, updatedAt: nowIso() } },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function transitionModelingJob(id, statuses, patch) {
  const database = await getDatabase();
  const updated = await database.collection('modelingJobs').findOneAndUpdate(
    { _id: id, status: { $in: statuses } },
    { $set: { ...patch, updatedAt: nowIso() } },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function saveModelingSourceImages(jobId, images) {
  const database = await getDatabase();
  const bucket = new GridFSBucket(database, { bucketName: 'modelingSourceImages' });
  const ids = {};
  try {
    for (const [view, image] of Object.entries(images)) {
      const id = randomUUID();
      await new Promise((resolve, reject) => {
        const stream = bucket.openUploadStreamWithId(id, image.name || `${view}.jpg`, {
          metadata: { jobId, view, contentType: image.type || 'application/octet-stream' }
        });
        stream.once('error', reject);
        stream.once('finish', resolve);
        stream.end(Buffer.from(image.buffer));
      });
      ids[view] = id;
    }
    await database.collection('modelingJobs').updateOne(
      { _id: jobId },
      { $set: { sourceImageIds: ids, updatedAt: nowIso() } }
    );
    return ids;
  } catch (error) {
    await Promise.all(Object.values(ids).map(id => bucket.delete(id).catch(() => {})));
    throw error;
  }
}

export async function loadModelingSourceImages(job) {
  const ids = job.sourceImageIds;
  if (!ids?.front || !ids?.right) throw new Error('Modeling source images are unavailable');
  const database = await getDatabase();
  const bucket = new GridFSBucket(database, { bucketName: 'modelingSourceImages' });
  const files = await database.collection('modelingSourceImages.files')
    .find({ _id: { $in: [ids.front, ids.right] } })
    .toArray();

  async function read(view) {
    const id = ids[view];
    const metadata = files.find(file => file._id === id);
    if (!metadata) throw new Error(`Missing ${view} modeling source image`);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = bucket.openDownloadStream(id);
      stream.on('data', chunk => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('end', resolve);
    });
    return {
      buffer: Buffer.concat(chunks),
      name: metadata.filename,
      type: metadata.metadata?.contentType || 'application/octet-stream'
    };
  }

  return { front: await read('front'), right: await read('right') };
}

export async function deleteModelingSourceImages(job) {
  const ids = Object.values(job.sourceImageIds || {});
  if (ids.length === 0) return;
  const database = await getDatabase();
  const bucket = new GridFSBucket(database, { bucketName: 'modelingSourceImages' });
  await Promise.all(ids.map(id => bucket.delete(id).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  })));
  await database.collection('modelingJobs').updateOne(
    { _id: job.id },
    { $unset: { sourceImageIds: '' }, $set: { updatedAt: nowIso() } }
  );
}

export async function updateUnsyncedObservation(id, input) {
  const database = await getDatabase();
  const observations = database.collection('observations');
  const current = await observations.findOne({ _id: id });
  if (!current) {
    const error = new Error('找不到觀測資料');
    error.status = 404;
    throw error;
  }
  if (!canModifyObservation(current)) {
    const error = new Error('已同步或同步中的資料不可修改');
    error.status = 409;
    throw error;
  }

  try {
    const updated = await observations.findOneAndUpdate(
      { _id: id, uploadStatus: { $in: ['pending', 'failed'] } },
      {
        $set: {
          plantId: input.plantId,
          observedAt: input.observedAt,
          height: input.height,
          nodes: input.nodes,
          internodeStatistics: input.internodeStatistics || current.internodeStatistics || null,
          note: input.note || '',
          uploadStatus: 'pending',
          lastError: null,
          uploadedAt: null,
          updatedAt: nowIso()
        }
      },
      { returnDocument: 'after' }
    );
    if (!updated) throw new Error('觀測資料已被同步，請重新整理後再試');
    return cleanDoc(updated);
  } catch (error) {
    if (error.code === 11000) throw duplicateObservationError();
    throw error;
  }
}

export async function deleteUnsyncedObservation(id) {
  const database = await getDatabase();
  const observations = database.collection('observations');
  const current = await observations.findOne({ _id: id });
  if (!current) {
    const error = new Error('找不到觀測資料');
    error.status = 404;
    throw error;
  }
  if (!canModifyObservation(current)) {
    const error = new Error('已同步或同步中的資料不可刪除');
    error.status = 409;
    throw error;
  }
  await observations.deleteOne({ _id: id, uploadStatus: { $in: ['pending', 'failed'] } });
  return cleanDoc(current);
}

export async function updateObservationUpload(id, patch) {
  const database = await getDatabase();
  const updated = await database.collection('observations').findOneAndUpdate(
    { _id: id },
    { $set: { ...patch, updatedAt: nowIso() } },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function claimObservationUpload(id) {
  const database = await getDatabase();
  const claimId = randomUUID();
  const staleBefore = new Date(Date.now() - Number(process.env.DATAHUB_CLAIM_TIMEOUT_MS || 10 * 60 * 1000)).toISOString();
  const updated = await database.collection('observations').findOneAndUpdate(
    {
      _id: id,
      $or: [
        { uploadStatus: { $in: ['pending', 'failed'] } },
        { uploadStatus: 'uploading', uploadClaimedAt: { $lt: staleBefore } }
      ]
    },
    {
      $set: {
        uploadStatus: 'uploading',
        uploadClaimId: claimId,
        uploadClaimedAt: nowIso(),
        lastError: null,
        updatedAt: nowIso()
      },
      $inc: { retryCount: 1 }
    },
    { returnDocument: 'after' }
  );
  return updated ? { observation: cleanDoc(updated), claimId } : null;
}

export async function finishObservationUpload(id, claimId, patch) {
  const database = await getDatabase();
  const updated = await database.collection('observations').findOneAndUpdate(
    { _id: id, uploadStatus: 'uploading', uploadClaimId: claimId },
    { $set: { ...patch, updatedAt: nowIso() }, $unset: { uploadClaimId: '', uploadClaimedAt: '' } },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function getObservation(id) {
  const database = await getDatabase();
  return cleanDoc(await database.collection('observations').findOne({ _id: id }));
}

export async function listObservations({ page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const database = await getDatabase();
  const docs = await database.collection('observations')
    .find({})
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit + 1)
    .toArray();

  return {
    observations: docs.slice(0, safeLimit).map(cleanDoc),
    page: safePage,
    pageSize: safeLimit,
    hasNext: docs.length > safeLimit,
    hasPrev: safePage > 1
  };
}

export async function listUnsyncedObservations(limit = 500) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const database = await getDatabase();
  const observations = await database.collection('observations')
    .find({ uploadStatus: { $in: ['pending', 'failed'] } })
    .sort({ observedAt: 1 })
    .limit(safeLimit)
    .toArray();
  return observations.map(cleanDoc);
}

export async function addUploadAttempt(attempt) {
  const database = await getDatabase();
  await database.collection('uploadAttempts').insertOne({ _id: randomUUID(), ...attempt, createdAt: nowIso() });
}

export async function createImportBatch({ fileName, format, total, user }) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const batch = {
    _id: randomUUID(),
    fileName: fileName || '',
    format: format || '',
    total,
    uploaded: 0,
    failed: 0,
    status: 'syncing',
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await database.collection('importBatches').insertOne(batch);
  return cleanDoc(batch);
}

export async function finishImportBatch(batchId, { uploaded, failed }) {
  const database = await getDatabase();
  const status = uploaded === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial_failed' : 'uploaded';
  const updated = await database.collection('importBatches').findOneAndUpdate(
    { _id: batchId },
    { $set: { uploaded, failed, status, updatedAt: nowIso(), completedAt: nowIso() } },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function updateImportBatchProgress(batchId, { uploaded, failed }) {
  const database = await getDatabase();
  await database.collection('importBatches').updateOne(
    { _id: batchId },
    { $set: { uploaded, failed, updatedAt: nowIso() } }
  );
}

export async function listRecentImportBatches(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const database = await getDatabase();
  const batches = await database.collection('importBatches').find({}).sort({ createdAt: -1 }).limit(safeLimit).toArray();
  return batches.map(cleanDoc);
}

export async function saveImportBatchItem(batchId, item) {
  const database = await getDatabase();
  const timestamp = nowIso();
  await database.collection('importBatchItems').updateOne(
    { batchId, index: item.index },
    { $set: { ...item, batchId, updatedAt: timestamp }, $setOnInsert: { _id: randomUUID(), createdAt: timestamp } },
    { upsert: true }
  );
}

export async function saveImportBatchItems(batchId, items) {
  if (items.length === 0) return;
  const database = await getDatabase();
  const timestamp = nowIso();
  await database.collection('importBatchItems').bulkWrite(items.map(item => ({
    updateOne: {
      filter: { batchId, index: item.index },
      update: {
        $set: { ...item, batchId, updatedAt: timestamp },
        $setOnInsert: { _id: randomUUID(), createdAt: timestamp }
      },
      upsert: true
    }
  })));
}
