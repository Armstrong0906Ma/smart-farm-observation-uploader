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

export const publicObservationCreateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  internodeStatistics: internodeStatisticsSchema.optional(),
  note: z.string().optional().default('')
}).strict();

const artifactUrlSchema = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && url.pathname !== '/'
    && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com'));
}, 'Artifact URL must be a public GCS HTTPS URL');

export const modelingResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('failed'),
    error: z.string().min(1)
  }).strict(),
  z.object({
    status: z.literal('succeeded'),
    plantId: z.string().min(1),
    observedAt: z.string().datetime(),
    height: z.number().finite(),
    nodes: z.number().int().nonnegative(),
    internodeStatistics: internodeStatisticsSchema,
    gifUrl: artifactUrlSchema.nullable(),
    glbUrl: artifactUrlSchema,
    annotatedGlbUrl: artifactUrlSchema,
    measurementUrl: artifactUrlSchema,
    nodesCsvUrl: artifactUrlSchema
  }).strict()
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
