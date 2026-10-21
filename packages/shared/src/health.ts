import { z } from 'zod';

const CheckStatus = z.enum(['ok', 'error']);

export const HealthResponse = z.object({
  status: CheckStatus,
  checks: z.object({ db: CheckStatus, redis: CheckStatus }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
