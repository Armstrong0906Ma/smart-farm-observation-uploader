import { requireUser } from '@/lib/authServer';
import { errorResponse, json } from '@/lib/http';
import {
  createImportBatch,
  ensureDefaultPlants,
  finishImportBatch,
  getPlant,
  saveImportBatchItem,
  saveImportBatchItems,
  updateImportBatchProgress
} from '@/lib/repositories';
import { uploadObservations } from '@/lib/uploaders';
import { z } from 'zod';

const importObservationSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  note: z.string().optional().default('file import'),
  source: z.literal('csv_import').default('csv_import')
});

const importSyncSchema = z.object({
  fileName: z.string().optional().default(''),
  format: z.string().optional().default(''),
  observations: z.array(importObservationSchema).min(1).max(1000)
});

function makeImportItem(index, observation, patch = {}) {
  return {
    index,
    plantId: observation.plantId,
    observedAt: observation.observedAt,
    height: observation.height,
    nodes: observation.nodes,
    note: observation.note,
    source: observation.source,
    status: patch.status || 'pending',
    error: patch.error || null,
    adapter: patch.adapter || null,
    timestampMs: patch.timestampMs || null
  };
}

async function processImportBatch(batchId, observations) {
  await ensureDefaultPlants();
  const validObservations = [];
  const validIndexes = [];
  let uploaded = 0;
  let failed = 0;

  async function recordResult(item) {
    if (item.status === 'uploaded') uploaded += 1;
    if (item.status === 'failed') failed += 1;
    await saveImportBatchItem(batchId, item);
    await updateImportBatchProgress(batchId, { uploaded, failed });
  }

  for (const [index, observation] of observations.entries()) {
    try {
      const plant = await getPlant(observation.plantId);
      if (!plant || !plant.enabled) throw new Error('植株編號不存在或未啟用');
      validIndexes.push(index);
      validObservations.push(observation);
    } catch (error) {
      await recordResult(makeImportItem(index, observation, { status: 'failed', error: error.message }));
    }
  }

  if (validObservations.length > 0) {
    try {
      await uploadObservations(validObservations, {
        onResult: async uploadResult => {
          const index = validIndexes[uploadResult.index];
          await recordResult(makeImportItem(index, observations[index], {
            status: uploadResult.status,
            error: uploadResult.error || null,
            adapter: uploadResult.adapter || null,
            timestampMs: uploadResult.timestampMs || null
          }));
        }
      });
    } catch (error) {
      for (const [validIndex, observation] of validObservations.entries()) {
        await recordResult(makeImportItem(validIndexes[validIndex], observation, {
          status: 'failed',
          error: error.message,
          adapter: process.env.DATAHUB_UPLOADER || 'mock'
        }));
      }
    }
  }

  await finishImportBatch(batchId, { uploaded, failed });
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const payload = importSyncSchema.parse(await request.json());
    const importBatch = await createImportBatch({
      fileName: payload.fileName,
      format: payload.format,
      total: payload.observations.length,
      user
    });

    await saveImportBatchItems(
      importBatch.id,
      payload.observations.map((observation, index) => makeImportItem(index, observation))
    );

    processImportBatch(importBatch.id, payload.observations).catch(error => {
      console.error(`Import batch ${importBatch.id} failed`, error);
    });

    return json({
      accepted: true,
      batchId: importBatch.id,
      batch: importBatch,
      total: payload.observations.length,
      uploaded: 0,
      failed: 0,
      results: []
    }, 202);
  } catch (error) {
    if (error.name === 'ZodError') {
      error.status = 400;
      error.message = '匯入資料格式錯誤';
    }
    return errorResponse(error);
  }
}
