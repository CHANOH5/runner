import { validationFailed } from './errors.js';

/**
 * 불투명 커서 (tech/06 4장): 정렬 키 배열을 base64url JSON으로 감싼다.
 * 앱은 내용을 해석하지 않는다. 잘못된 커서는 400.
 */
export type SortKey = (string | number)[];

export function encodeCursor(key: SortKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined, length: number): SortKey | null {
  if (cursor === undefined) return null;
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(key) &&
      key.length === length &&
      key.every((v) => typeof v === 'string' || typeof v === 'number')
    ) {
      return key;
    }
  } catch {
    // 아래에서 400
  }
  throw validationFailed([{ path: 'cursor', code: 'invalid_format' }]);
}

/** 정렬 키 비교 (각 자리 오름차순). 내림차순 자리는 호출 측에서 키를 뒤집어 넣는다 */
export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * 메모리에서 정렬된 목록을 커서로 자른다. Phase 1 대회 수(수백 개)·사용자별 목록 규모 기준.
 * 수천 개를 넘으면 SQL keyset으로 바꾼다.
 */
export function paginate<T>(
  sorted: T[],
  keyOf: (item: T) => SortKey,
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const first = sorted[0];
  const after = decodeCursor(cursor, first ? keyOf(first).length : 0);
  const start = after ? sorted.filter((it) => compareKeys(keyOf(it), after) > 0) : sorted;
  const items = start.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: start.length > limit && last ? encodeCursor(keyOf(last)) : null,
  };
}
