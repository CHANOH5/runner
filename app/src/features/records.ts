import type { RunRecord } from '@berun/shared';
import { api } from '../api';
import { isApiError } from '../api/client';
import type { RecordValues } from './recordForm';

/**
 * 기록 저장 + 중복 확인 (PRD 4.4): 409 DUPLICATE_RECORD → "같은 기록이 이미 있어요. 그래도 저장할까요?"
 * → [저장]이면 confirmDuplicate: true로 다시 보낸다. 취소하면 null.
 */
export async function saveRecordWithDuplicateCheck(
  values: RecordValues,
  confirm: () => Promise<boolean>,
  recordId?: string,
): Promise<RunRecord | null> {
  const send = (confirmDuplicate: boolean) =>
    recordId
      ? api.updateRecord(recordId, { ...values, confirmDuplicate })
      : api.createRecord({ ...values, confirmDuplicate });
  try {
    return await send(false);
  } catch (e) {
    if (isApiError(e) && e.code === 'DUPLICATE_RECORD') {
      return (await confirm()) ? send(true) : null;
    }
    throw e;
  }
}

/** 기록이 바뀌면 예측·홈 카드도 다시 읽는다 (recordsChangedSince) */
export const RECORD_RELATED_KEYS = [
  ['records'],
  ['predictions'],
  ['home'],
  ['strategy'],
  ['candidates'],
];
