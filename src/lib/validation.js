import { z } from 'zod';

export const observationCreateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  source: z.enum(['manual', 'csv_import', 'robot_vision', 'api']).default('manual'),
  note: z.string().optional().default('')
});

export const observationUpdateSchema = z.object({
  plantId: z.string().min(1),
  observedAt: z.string().datetime(),
  height: z.number().finite(),
  nodes: z.number().int().nonnegative(),
  note: z.string().optional().default('')
});
