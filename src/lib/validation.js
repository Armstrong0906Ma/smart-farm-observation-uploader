import { z } from 'zod';

const internodeSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  mean: z.number().finite().nullable(),
  standard_deviation: z.number().finite().nullable(),
  minimum: z.number().finite().nullable(),
  maximum: z.number().finite().nullable()
});

const internodeStatisticsSchema = z.object({
  definition: z.string().optional(),
  standard_deviation_type: z.string().optional(),
  overall: internodeSummarySchema,
  internodes_1_to_9: internodeSummarySchema,
  internodes_10_to_15: internodeSummarySchema,
  internodes_16_and_above: internodeSummarySchema
});

export const observationCreateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  internodeStatistics: internodeStatisticsSchema.optional(),
  gifUrl: z.string().url().nullable().optional(),
  glbUrl: z.string().url().nullable().optional(),
  annotatedGlbUrl: z.string().url().nullable().optional(),
  measurementUrl: z.string().url().nullable().optional(),
  modelingJobId: z.string().nullable().optional(),
  source: z.enum(['manual', 'csv_import', 'robot_vision', 'api']).default('manual'),
  note: z.string().optional().default('')
});

export const modelingResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('failed'),
    error: z.string().min(1)
  }),
  z.object({
    status: z.literal('succeeded'),
    plantId: z.string().min(1),
    observedAt: z.string().datetime(),
    height: z.number().finite(),
    nodes: z.number().int().nonnegative(),
    internodeStatistics: internodeStatisticsSchema,
    gifUrl: z.string().url().nullable(),
    glbUrl: z.string().url(),
    annotatedGlbUrl: z.string().url(),
    measurementUrl: z.string().url()
  })
]);

export const modelingTaskSchema = z.object({
  jobId: z.string().min(1)
});

export const dataHubTaskSchema = z.object({
  observationId: z.string().min(1)
});

export const observationUpdateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  internodeStatistics: internodeStatisticsSchema.optional(),
  note: z.string().optional().default('')
});
