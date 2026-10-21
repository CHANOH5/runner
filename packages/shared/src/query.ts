import { z } from 'zod';

/** 쿼리스트링 배열: `?region=seoul&region=busan` → 배열, `?region=seoul` → 한 개짜리 배열 */
export const arrayParam = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item));

/** 쿼리스트링 불리언: 'true' | 'false'만 받는다 (z.coerce.boolean은 'false'도 true가 된다) */
export const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

/** 커서 페이지네이션 (tech/06 4장) */
export const PageQuery = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    /** null이면 끝 */
    nextCursor: z.string().nullable(),
  });
