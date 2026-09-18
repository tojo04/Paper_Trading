import { z } from 'zod';

export const serviceStatusSchema = z.enum(['up', 'down']);

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('paper-terminal-api'),
  timestamp: z.string(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  service: z.literal('paper-terminal-api'),
  checks: z.object({
    database: z.object({
      status: serviceStatusSchema,
    }),
  }),
  timestamp: z.string(),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
