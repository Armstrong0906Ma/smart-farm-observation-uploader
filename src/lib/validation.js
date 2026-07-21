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
    analysisGifUrl: artifactUrlSchema.optional(),
    frontImageUrl: artifactUrlSchema.optional(),
    rightImageUrl: artifactUrlSchema.optional(),
    glbUrl: artifactUrlSchema,
    annotatedGlbUrl: artifactUrlSchema,
    measurementUrl: artifactUrlSchema,
    nodesCsvUrl: artifactUrlSchema,
    calibrationProfile: z.enum(['manual', 'robot_camera']).optional(),
    modelToCmScale: z.number().finite().positive().optional()
  }).strict()
]).superRefine((value, context) => {
  if (value.status !== 'succeeded') return;
  if (Boolean(value.frontImageUrl) !== Boolean(value.rightImageUrl)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['frontImageUrl'],
      message: 'frontImageUrl and rightImageUrl must be provided together'
    });
  }
  if (Boolean(value.calibrationProfile) !== Boolean(value.modelToCmScale)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['calibrationProfile'],
      message: 'calibrationProfile and modelToCmScale must be provided together'
    });
  }
});

export const modelingTaskSchema = z.object({
  jobId: z.string().min(1)
});

export const modelingProgressSchema = z.object({
  phase: z.enum([
    'preparing',
    'uploading_sources',
    'submitting',
    'modeling',
    'downloading',
    'converting',
    'analyzing',
    'simplifying',
    'rendering',
    'uploading',
    'callback_pending',
    'retry_wait'
  ]),
  overallPercent: z.number().int().min(0).max(99),
  remotePercent: z.number().int().min(0).max(100).nullable().default(null),
  remoteStatus: z.string().max(64).nullable().default(null),
  attempt: z.number().int().min(1).max(2).default(1),
  maxAttempts: z.number().int().min(1).max(2).default(2),
  retryMode: z.enum([
    'resume_creation',
    'regenerate_remote_terminal',
    'resubmit_ambiguous',
    'retry_pre_generate'
  ]).nullable().default(null)
}).strict();

export const dataHubTaskSchema = z.object({
  observationId: z.string().min(1)
});

export const dashboardTaskSchema = z.object({
  observationId: z.string().min(1)
}).strict();

export const observationUpdateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  internodeStatistics: internodeStatisticsSchema.optional(),
  note: z.string().optional().default('')
});
