import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://paper_terminal:local-development-only@localhost:5432/paper_terminal'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export type ApiConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return environmentSchema.parse(environment);
}
