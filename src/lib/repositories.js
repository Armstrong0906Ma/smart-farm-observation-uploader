import { firestore } from '@/lib/firebaseAdmin';
import { defaultPlants } from '@/lib/plants';

function nowIso() {
  return new Date().toISOString();
}

let defaultPlantsEnsured = false;

function observationId(plantId, observedAt) {
  const timestampMs = new Date(observedAt).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error('observedAt 格式錯誤');
  return `${plantId}_${timestampMs}`;
}

function canModifyObservation(observation) {
  return observation.uploadStatus === 'pending' || observation.uploadStatus === 'failed';
}

function cleanDoc(doc) {
  return { id: doc.id, ...doc.data() };
}

export async function ensureDefaultPlants() {
  if (defaultPlantsEnsured) return;

  const plants = defaultPlants();
  const refs = plants.map(plant => firestore.collection('plants').doc(plant.plantId));
  const docs = await firestore.getAll(...refs);
  const batch = firestore.batch();
  const timestamp = nowIso();
  let missingCount = 0;

  for (const [index, doc] of docs.entries()) {
    if (!doc.exists) {
      batch.set(refs[index], { ...plants[index], createdAt: timestamp, updatedAt: timestamp });
      missingCount += 1;
    }
  }

  if (missingCount > 0) await batch.commit();
  defaultPlantsEnsured = true;
}

export async function listPlants() {
  await ensureDefaultPlants();
  const snapshot = await firestore.collection('plants').where('enabled', '==', true).get();
  return snapshot.docs.map(cleanDoc).sort((a, b) => a.plantId.localeCompare(b.plantId));
}

export async function getPlant(plantId) {
  const doc = await firestore.collection('plants').doc(plantId).get();
  return doc.exists ? cleanDoc(doc) : null;
}

export async function createObservation(input, user) {
  const id = observationId(input.plantId, input.observedAt);
  const ref = firestore.collection('observations').doc(id);
  const doc = await ref.get();
  if (doc.exists) {
    const error = new Error('同一植株與觀測時間已存在，請改用修改或重新上傳');
    error.status = 409;
    throw error;
  }

  const timestamp = nowIso();
  const observation = {
    plantId: input.plantId,
    observedAt: input.observedAt,
    height: input.height,
    nodes: input.nodes,
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

  await ref.set(observation);
  return { id, ...observation };
}

export async function updateUnsyncedObservation(id, input) {
  const currentRef = firestore.collection('observations').doc(id);
  const nextId = observationId(input.plantId, input.observedAt);
  const nextRef = firestore.collection('observations').doc(nextId);
  const timestamp = nowIso();

  return firestore.runTransaction(async transaction => {
    const currentDoc = await transaction.get(currentRef);
    if (!currentDoc.exists) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }

    const current = { id: currentDoc.id, ...currentDoc.data() };
    if (!canModifyObservation(current)) {
      const error = new Error('已同步或同步中的資料不可修改');
      error.status = 409;
      throw error;
    }

    if (nextId !== id) {
      const nextDoc = await transaction.get(nextRef);
      if (nextDoc.exists) {
        const error = new Error('同一植株與觀測時間已存在');
        error.status = 409;
        throw error;
      }
    }

    const updated = {
      ...current,
      plantId: input.plantId,
      observedAt: input.observedAt,
      height: input.height,
      nodes: input.nodes,
      note: input.note || '',
      uploadStatus: 'pending',
      lastError: null,
      uploadedAt: null,
      updatedAt: timestamp
    };
    delete updated.id;

    if (nextId === id) {
      transaction.update(currentRef, updated);
    } else {
      transaction.delete(currentRef);
      transaction.set(nextRef, updated);
    }

    return { id: nextId, ...updated };
  });
}

export async function deleteUnsyncedObservation(id) {
  const ref = firestore.collection('observations').doc(id);

  return firestore.runTransaction(async transaction => {
    const doc = await transaction.get(ref);
    if (!doc.exists) {
      const error = new Error('找不到觀測資料');
      error.status = 404;
      throw error;
    }

    const observation = { id: doc.id, ...doc.data() };
    if (!canModifyObservation(observation)) {
      const error = new Error('已同步或同步中的資料不可刪除');
      error.status = 409;
      throw error;
    }

    transaction.delete(ref);
    return observation;
  });
}

export async function updateObservationUpload(id, patch) {
  const timestamp = nowIso();
  const ref = firestore.collection('observations').doc(id);
  await ref.update({ ...patch, updatedAt: timestamp });
  const doc = await ref.get();
  return cleanDoc(doc);
}

export async function getObservation(id) {
  const doc = await firestore.collection('observations').doc(id).get();
  return doc.exists ? cleanDoc(doc) : null;
}

export async function listObservations({ page = 1, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const snapshot = await firestore
    .collection('observations')
    .orderBy('createdAt', 'desc')
    .offset((safePage - 1) * safeLimit)
    .limit(safeLimit + 1)
    .get();
  const docs = snapshot.docs.map(cleanDoc);

  return {
    observations: docs.slice(0, safeLimit),
    page: safePage,
    pageSize: safeLimit,
    hasNext: docs.length > safeLimit,
    hasPrev: safePage > 1
  };
}

export async function listUnsyncedObservations(limit = 500) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const pendingSnapshot = await firestore.collection('observations').where('uploadStatus', '==', 'pending').limit(safeLimit).get();
  const remaining = safeLimit - pendingSnapshot.size;
  const failedSnapshot = remaining > 0
    ? await firestore.collection('observations').where('uploadStatus', '==', 'failed').limit(remaining).get()
    : { docs: [] };

  return [...pendingSnapshot.docs, ...failedSnapshot.docs]
    .map(cleanDoc)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
}

export async function addUploadAttempt(attempt) {
  await firestore.collection('uploadAttempts').add({ ...attempt, createdAt: nowIso() });
}

export async function createImportBatch({ fileName, format, total, user }) {
  const timestamp = nowIso();
  const ref = firestore.collection('importBatches').doc();
  const batch = {
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

  await ref.set(batch);
  return { id: ref.id, ...batch };
}

export async function finishImportBatch(batchId, { uploaded, failed }) {
  const timestamp = nowIso();
  const status = uploaded === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial_failed' : 'uploaded';
  const ref = firestore.collection('importBatches').doc(batchId);
  await ref.update({ uploaded, failed, status, updatedAt: timestamp, completedAt: timestamp });
  const doc = await ref.get();
  return cleanDoc(doc);
}

export async function updateImportBatchProgress(batchId, { uploaded, failed }) {
  const ref = firestore.collection('importBatches').doc(batchId);
  await ref.update({ uploaded, failed, updatedAt: nowIso() });
}

export async function listRecentImportBatches(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const snapshot = await firestore
    .collection('importBatches')
    .orderBy('createdAt', 'desc')
    .limit(safeLimit)
    .get();

  return snapshot.docs.map(cleanDoc);
}

export async function saveImportBatchItem(batchId, item) {
  const timestamp = nowIso();
  const ref = firestore
    .collection('importBatches')
    .doc(batchId)
    .collection('items')
    .doc(String(item.index).padStart(6, '0'));

  await ref.set({ ...item, updatedAt: timestamp }, { merge: true });
}

export async function saveImportBatchItems(batchId, items) {
  const timestamp = nowIso();
  const collection = firestore.collection('importBatches').doc(batchId).collection('items');

  for (let start = 0; start < items.length; start += 450) {
    const batch = firestore.batch();
    items.slice(start, start + 450).forEach(item => {
      const ref = collection.doc(String(item.index).padStart(6, '0'));
      batch.set(ref, { ...item, createdAt: timestamp, updatedAt: timestamp });
    });
    await batch.commit();
  }
}
