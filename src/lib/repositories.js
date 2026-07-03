import { firestore } from '@/lib/firebaseAdmin';
import { defaultPlants } from '@/lib/plants';

function nowIso() {
  return new Date().toISOString();
}

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
  const snapshot = await firestore.collection('plants').limit(1).get();
  if (!snapshot.empty) return;

  const batch = firestore.batch();
  const timestamp = nowIso();
  for (const plant of defaultPlants()) {
    const ref = firestore.collection('plants').doc(plant.plantId);
    batch.set(ref, { ...plant, createdAt: timestamp, updatedAt: timestamp });
  }
  await batch.commit();
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

export async function listObservations(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const snapshot = await firestore.collection('observations').orderBy('createdAt', 'desc').limit(safeLimit).get();
  return snapshot.docs.map(cleanDoc);
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
