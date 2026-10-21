import { z } from 'zod';

/** UUID v7 문자열 (tech/06 1장) */
export const Id = z.uuid();
/** KST 날짜 `YYYY-MM-DD` */
export const DateStr = z.iso.date();
/** ISO 8601 시각. 요청은 어떤 오프셋이든 받고, 응답은 항상 `+09:00` */
export const DateTime = z.iso.datetime({ offset: true });

export const REGION_CODES = [
  'seoul',
  'busan',
  'daegu',
  'incheon',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gyeonggi',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;
export const RegionCode = z.enum(REGION_CODES);
export type RegionCode = z.infer<typeof RegionCode>;

/** 거리 분류 (PRD 3.3) */
export const DistanceCategory = z.enum(['5k', '10k', 'half', 'full', 'other']);
export type DistanceCategory = z.infer<typeof DistanceCategory>;

/** 표준 거리 (PRD 3.2) */
export const STANDARD_DISTANCE_M = {
  '5k': 5000,
  '10k': 10000,
  half: 21097,
  full: 42195,
} as const satisfies Record<Exclude<DistanceCategory, 'other'>, number>;

export const Provider = z.enum(['kakao', 'apple', 'google']);
export type Provider = z.infer<typeof Provider>;
