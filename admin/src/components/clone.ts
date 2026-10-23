import { CloneRes } from '@berun/shared';
import { api } from '@/lib/api';

/** 복제 (PRD 8.4.4) → 새 초안 수정 화면. 노란 강조할 칸과 원본 이름을 쿼리로 넘긴다 */
export async function cloneAndOpen(
  raceId: string,
  sourceName: string,
  push: (url: string) => void,
) {
  const res = await api('POST', `/races/${raceId}/clone`, { body: {}, schema: CloneRes });
  const p = new URLSearchParams({ clonedFrom: sourceName, shifted: res.shiftedFields.join(',') });
  push(`/races/${res.race.id}?${p.toString()}`);
}
