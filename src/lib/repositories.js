import { randomUUID } from 'crypto';
import { GridFSBucket } from 'mongodb';
import { getDatabase } from '@/lib/mongodb';
import { defaultPlants } from '@/lib/plants';

function nowIso() {
  return new Date().toISOString();
}

function dataHubClaimTimeoutMs() {
  const value = Number(process.env.DATAHUB_CLAIM_TIMEOUT_MS || 10 * 60 * 1000);
  return Number.isFinite(value) && value > 0 ? value : 10 * 60 * 1000;
}

function dashboardClaimTimeoutMs() {
  const value = Number(process.env.DASHBOARD_CLAIM_TIMEOUT_MS || 10 * 60 * 1000);
  return Number.isFinite(value) && value > 0 ? value : 10 * 60 * 1000;
}

function dashboardLeaseMs() {
  const value = Number(process.env.DASHBOARD_LEASE_MS || 5 * 60 * 1000);
  return Number.isFinite(value) && value > 0 ? value : 5 * 60 * 1000;
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
  error.code = 'OBSERVATION_NATURAL_KEY_CONFLICT';
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
    gifUrl: null,
    analysisGifUrl: null,
    frontImageUrl: null,
    rightImageUrl: null,
    glbUrl: null,
    annotatedGlbUrl: null,
    measurementUrl: null,
    nodesCsvUrl: null,
    source: 'manual',
    note: input.note || '',
    uploadStatus: 'pending',
    retryCount: 0,
    lastError: null,
    uploadedAt: null,
    dashboardStatus: 'not_applicable',
    dashboardRetryCount: 0,
    dashboardLastError: null,
    dashboardPublishedAt: null,
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };
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
    analysisGifUrl: input.analysisGifUrl || null,
    frontImageUrl: input.frontImageUrl || null,
    rightImageUrl: input.rightImageUrl || null,
    glbUrl: input.glbUrl || null,
    annotatedGlbUrl: input.annotatedGlbUrl || null,
    measurementUrl: input.measurementUrl || null,
    nodesCsvUrl: input.nodesCsvUrl || null,
    calibrationProfile: input.calibrationProfile || null,
    modelToCmScale: input.modelToCmScale ?? null,
    modelingJobId: input.modelingJobId,
    source: 'robot_vision',
    note: input.note || '',
    uploadStatus: 'pending',
    retryCount: 0,
    lastError: null,
    uploadedAt: null,
    dashboardStatus: input.dashboardStatus || 'not_applicable',
    dashboardRetryCount: 0,
    dashboardLastError: input.dashboardLastError || null,
    dashboardPublishedAt: null,
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

export async function createModelingJob({
  plantId,
  observedAt,
  submissionKey,
  user,
  submissionSource = 'manual'
}) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const job = {
    _id: randomUUID(),
    plantId,
    observedAt,
    submissionKey,
    status: 'queued',
    progress: {
      phase: 'queued',
      overallPercent: 2,
      remotePercent: null,
      remoteStatus: null,
      attempt: 1,
      maxAttempts: 2,
      retryMode: null,
      updatedAt: timestamp
    },
    dataHubStatus: null,
    error: null,
    observationId: null,
    submissionSource,
    createdBy: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  try {
    await database.collection('modelingJobs').insertOne(job);
    return { job: cleanDoc(job), created: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await database.collection('modelingJobs').findOne({ createdBy: user.uid, submissionKey });
    if (!existing) throw error;
    if (existing.plantId !== plantId || existing.observedAt !== observedAt) {
      const conflict = new Error('Submission key was already used with different job metadata');
      conflict.status = 409;
      throw conflict;
    }
    return { job: cleanDoc(existing), created: false };
  }
}

export async function getModelingJob(id) {
  const database = await getDatabase();
  return cleanDoc(await database.collection('modelingJobs').findOne({ _id: id }));
}

export async function listActiveModelingJobs() {
  const database = await getDatabase();
  const jobs = await database.collection('modelingJobs').find({
    $or: [
      { status: { $in: ['queued', 'dispatching', 'processing'] } },
      {
        status: 'succeeded',
        dataHubStatus: { $nin: ['uploaded', 'failed'] }
      }
    ]
  }, {
    projection: {
      plantId: 1,
      observedAt: 1,
      status: 1,
      progress: 1,
      dataHubStatus: 1,
      submissionSource: 1,
      createdAt: 1,
      updatedAt: 1
    }
  }).sort({ createdAt: 1 }).limit(100).toArray();
  return jobs.map(cleanDoc);
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

export async function updateModelingJobProgress(id, progress) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const current = await database.collection('modelingJobs').findOne({ _id: id });
  if (!current || !['queued', 'dispatching', 'processing'].includes(current.status)) return null;
  const currentAttempt = Number(current.progress?.attempt || 1);
  const nextAttempt = Number(progress.attempt || 1);
  const attemptGuard = current.progress?.attempt === undefined
    ? { $or: [{ 'progress.attempt': { $exists: false } }, { 'progress.attempt': currentAttempt }] }
    : { 'progress.attempt': currentAttempt };
  if (nextAttempt < currentAttempt) return cleanDoc(current);
  if (nextAttempt > currentAttempt) {
    const updatedForRetry = await database.collection('modelingJobs').findOneAndUpdate(
      { _id: id, status: { $in: ['queued', 'dispatching', 'processing'] }, ...attemptGuard },
      {
        $set: {
          progress: { ...progress, updatedAt: timestamp },
          updatedAt: timestamp
        }
      },
      { returnDocument: 'after' }
    );
    return cleanDoc(updatedForRetry);
  }
  if (progress.phase === 'retry_wait') {
    const waiting = await database.collection('modelingJobs').findOneAndUpdate(
      { _id: id, status: { $in: ['queued', 'dispatching', 'processing'] }, ...attemptGuard },
      {
        $set: {
          'progress.phase': progress.phase,
          'progress.remoteStatus': progress.remoteStatus,
          'progress.attempt': nextAttempt,
          'progress.maxAttempts': progress.maxAttempts || 2,
          'progress.retryMode': progress.retryMode || null,
          'progress.updatedAt': timestamp,
          updatedAt: timestamp
        },
        $max: { 'progress.overallPercent': progress.overallPercent }
      },
      { returnDocument: 'after' }
    );
    return cleanDoc(waiting);
  }
  const updated = await database.collection('modelingJobs').findOneAndUpdate(
    {
      _id: id,
      status: { $in: ['queued', 'dispatching', 'processing'] },
      $and: [
        attemptGuard,
        {
          $or: [
            { 'progress.overallPercent': { $exists: false } },
            { 'progress.overallPercent': { $lte: progress.overallPercent } }
          ]
        }
      ]
    },
    {
      $set: {
        'progress.phase': progress.phase,
        'progress.remoteStatus': progress.remoteStatus,
        'progress.attempt': nextAttempt,
        'progress.maxAttempts': progress.maxAttempts || 2,
        'progress.retryMode': progress.retryMode || null,
        'progress.updatedAt': timestamp,
        updatedAt: timestamp
      },
      $max: {
        'progress.overallPercent': progress.overallPercent,
        ...(progress.remotePercent === null ? {} : { 'progress.remotePercent': progress.remotePercent })
      }
    },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function saveModelingSourceImages(jobId, images) {
  const database = await getDatabase();
  const bucket = new GridFSBucket(database, { bucketName: 'modelingSourceImages' });
  const existingJob = await database.collection('modelingJobs').findOne({ _id: jobId });
  if (existingJob?.sourceImageIds?.front && existingJob?.sourceImageIds?.right) {
    return existingJob.sourceImageIds;
  }
  const ids = {};
  for (const [view, image] of Object.entries(images)) {
    const id = `${jobId}:${view}`;
    const exists = await database.collection('modelingSourceImages.files').findOne({ _id: id });
    if (!exists) {
      try {
        await new Promise((resolve, reject) => {
          const stream = bucket.openUploadStreamWithId(id, image.name || `${view}.jpg`, {
            metadata: { jobId, view, contentType: image.type || 'application/octet-stream' }
          });
          stream.once('error', reject);
          stream.once('finish', resolve);
          stream.end(Buffer.from(image.buffer));
        });
      } catch (error) {
        // A concurrent replay may have completed the same deterministic file first.
        const concurrentFile = await database.collection('modelingSourceImages.files').findOne({ _id: id });
        if (!concurrentFile) throw error;
      }
    }
    ids[view] = id;
  }
  await database.collection('modelingJobs').updateOne(
    { _id: jobId },
    { $set: { sourceImageIds: ids, updatedAt: nowIso() } }
  );
  return ids;
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
  const staleBefore = new Date(Date.now() - dataHubClaimTimeoutMs()).toISOString();
  const updated = await database.collection('observations').findOneAndUpdate(
    {
      _id: id,
      $or: [
        { uploadStatus: { $in: ['pending', 'failed'] } },
        {
          uploadStatus: 'uploading',
          $or: [
            { uploadClaimedAt: { $lt: staleBefore } },
            { uploadClaimedAt: { $exists: false } }
          ]
        }
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

export async function prepareObservationDashboardPublication(id) {
  const database = await getDatabase();
  const updated = await database.collection('observations').findOneAndUpdate(
    {
      _id: id,
      dashboardStatus: { $nin: ['publishing', 'published'] },
      frontImageUrl: { $type: 'string', $ne: '' },
      rightImageUrl: { $type: 'string', $ne: '' },
      analysisGifUrl: { $type: 'string', $ne: '' }
    },
    {
      $set: {
        dashboardStatus: 'pending',
        dashboardLastError: null,
        updatedAt: nowIso()
      }
    },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function markObservationDashboardFailure(id, message) {
  const database = await getDatabase();
  const updated = await database.collection('observations').findOneAndUpdate(
    { _id: id, dashboardStatus: { $ne: 'published' } },
    {
      $set: {
        dashboardStatus: 'failed',
        dashboardLastError: message,
        updatedAt: nowIso()
      }
    },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function claimObservationDashboardPublication(id) {
  const database = await getDatabase();
  const claimId = randomUUID();
  const timestamp = nowIso();
  const staleBefore = new Date(Date.now() - dashboardClaimTimeoutMs()).toISOString();
  const updated = await database.collection('observations').findOneAndUpdate(
    {
      _id: id,
      $or: [
        { dashboardStatus: { $in: ['pending', 'failed'] } },
        {
          dashboardStatus: 'publishing',
          $or: [
            { dashboardClaimedAt: { $lt: staleBefore } },
            { dashboardClaimedAt: { $exists: false } }
          ]
        }
      ]
    },
    {
      $set: {
        dashboardStatus: 'publishing',
        dashboardClaimId: claimId,
        dashboardClaimedAt: timestamp,
        dashboardLastError: null,
        updatedAt: timestamp
      },
      $inc: { dashboardRetryCount: 1 }
    },
    { returnDocument: 'after' }
  );
  return updated ? { observation: cleanDoc(updated), claimId } : null;
}

export async function finishObservationDashboardPublication(id, claimId, patch) {
  const database = await getDatabase();
  const updated = await database.collection('observations').findOneAndUpdate(
    { _id: id, dashboardStatus: 'publishing', dashboardClaimId: claimId },
    {
      $set: { ...patch, updatedAt: nowIso() },
      $unset: { dashboardClaimId: '', dashboardClaimedAt: '' }
    },
    { returnDocument: 'after' }
  );
  return cleanDoc(updated);
}

export async function getLatestDashboardObservation(plantId) {
  const database = await getDatabase();
  const observation = await database.collection('observations').findOne(
    {
      plantId,
      source: 'robot_vision',
      frontImageUrl: { $type: 'string', $ne: '' },
      rightImageUrl: { $type: 'string', $ne: '' },
      analysisGifUrl: { $type: 'string', $ne: '' }
    },
    { sort: { observedAt: -1, createdAt: -1, _id: -1 } }
  );
  return cleanDoc(observation);
}

export async function acquireDashboardPublicationLease(ownerId) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + dashboardLeaseMs()).toISOString();
  try {
    const lease = await database.collection('dashboardPublicationLocks').findOneAndUpdate(
      {
        _id: 'representative-media',
        $or: [
          { expiresAt: { $lte: timestamp } },
          { expiresAt: { $exists: false } },
          { ownerId }
        ]
      },
      {
        $set: { ownerId, acquiredAt: timestamp, expiresAt, updatedAt: timestamp }
      },
      { upsert: true, returnDocument: 'after' }
    );
    return lease?.ownerId === ownerId;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

export async function renewDashboardPublicationLease(ownerId) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const renewed = await database.collection('dashboardPublicationLocks').findOneAndUpdate(
    { _id: 'representative-media', ownerId, expiresAt: { $gt: timestamp } },
    {
      $set: {
        expiresAt: new Date(Date.now() + dashboardLeaseMs()).toISOString(),
        updatedAt: timestamp
      }
    },
    { returnDocument: 'after' }
  );
  return renewed?.ownerId === ownerId;
}

export async function releaseDashboardPublicationLease(ownerId) {
  const database = await getDatabase();
  await database.collection('dashboardPublicationLocks').deleteOne({
    _id: 'representative-media',
    ownerId
  });
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
  const staleBefore = new Date(Date.now() - dataHubClaimTimeoutMs()).toISOString();
  const observations = await database.collection('observations')
    .find({
      $or: [
        { uploadStatus: { $in: ['pending', 'failed'] } },
        { uploadStatus: 'uploading', uploadClaimedAt: { $lt: staleBefore } },
        { uploadStatus: 'uploading', uploadClaimedAt: { $exists: false } }
      ]
    })
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

export async function initializeAutoCapture(pair, plantId) {
  const database = await getDatabase();
  const timestamp = nowIso();
  try {
    await database.collection('autoCaptureState').updateOne(
      { _id: 'robot-camera' },
      {
        $setOnInsert: {
          baselineFingerprint: pair.fingerprint,
          baselineObservedAt: pair.observedAt,
          plantId,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const state = await database.collection('autoCaptureState').findOne({ _id: 'robot-camera' });
  const baseline = state?.baselineFingerprint === pair.fingerprint;
  if (baseline) {
    await database.collection('autoCapturePairs').updateOne(
      { _id: pair.fingerprint },
      {
        $setOnInsert: {
          ...pair,
          plantId,
          status: 'baseline',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      { upsert: true }
    );
  }
  return { baseline };
}

export async function recordAutoCapturePair(pair, plantId) {
  const database = await getDatabase();
  const timestamp = nowIso();
  let record;
  try {
    record = await database.collection('autoCapturePairs').findOneAndUpdate(
      { _id: pair.fingerprint },
      {
        $setOnInsert: {
          ...pair,
          plantId,
          status: 'pending',
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    record = await database.collection('autoCapturePairs').findOne({ _id: pair.fingerprint });
  }
  return cleanDoc(record);
}

export async function claimAutoCapturePair(fingerprint) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const leaseId = randomUUID();
  const leaseUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const pair = await database.collection('autoCapturePairs').findOneAndUpdate(
    {
      _id: fingerprint,
      status: { $in: ['pending', 'error', 'processing'] },
      $or: [
        { status: { $in: ['pending', 'error'] } },
        { leaseUntil: { $lte: timestamp } },
        { leaseUntil: { $exists: false } }
      ]
    },
    {
      $set: {
        status: 'processing',
        leaseId,
        leaseUntil,
        updatedAt: timestamp
      }
    },
    { returnDocument: 'after' }
  );
  return cleanDoc(pair);
}

export async function markAutoCapturePairSubmitted(fingerprint, jobId) {
  const database = await getDatabase();
  await database.collection('autoCapturePairs').updateOne(
    { _id: fingerprint },
    {
      $set: { status: 'submitted', jobId, error: null, submittedAt: nowIso(), updatedAt: nowIso() },
      $unset: { leaseId: '', leaseUntil: '' }
    }
  );
}

export async function markAutoCapturePairError(fingerprint, message) {
  const database = await getDatabase();
  await database.collection('autoCapturePairs').updateOne(
    { _id: fingerprint },
    {
      $set: { status: 'error', error: message, updatedAt: nowIso() },
      $unset: { leaseId: '', leaseUntil: '' }
    }
  );
}
