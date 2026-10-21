import { z } from 'zod';
import { DateStr, DateTime, DistanceCategory, Id } from './common.js';

export const RunKind = z.enum(['race', 'training']);
export type RunKind = z.infer<typeof RunKind>;

/** 기록 (tech/06 5장) */
export const RunRecord = z.object({
  id: Id,
  category: DistanceCategory,
  distanceM: z.number().int(),
  durationSec: z.number().int(),
  paceSecPerKm: z.number().int(),
  runDate: DateStr,
  kind: RunKind,
  title: z.string().nullable(),
  usableForPrediction: z.boolean(),
  createdAt: DateTime,
});
export type RunRecord = z.infer<typeof RunRecord>;
