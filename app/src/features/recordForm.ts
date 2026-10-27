import {
  RECORD_MIN_DATE,
  recordShapeIssues,
  STANDARD_DISTANCE_M,
  type DistanceCategory,
  type RunKind,
  type RunRecord,
} from '@berun/shared';
import { hmsToSec, secToHms } from '../lib/format';

/** 기록 입력 폼 상태 (S-005, S-031 — PRD 4.4) */
export type RecordFormState = {
  category: DistanceCategory | null;
  /** 기타 거리 km (소수점 첫째 자리까지) */
  otherKm: string;
  duration: { h: string; m: string; s: string };
  runDate: string;
  kind: RunKind;
  title: string;
};

export const emptyRecordForm = (today: string): RecordFormState => ({
  category: null,
  otherKm: '',
  duration: { h: '', m: '', s: '' },
  runDate: today,
  kind: 'race',
  title: '',
});

export function recordToForm(r: RunRecord): RecordFormState {
  return {
    category: r.category,
    otherKm: r.category === 'other' ? String(r.distanceM / 1000) : '',
    duration: secToHms(r.durationSec),
    runDate: r.runDate,
    kind: r.kind,
    title: r.title ?? '',
  };
}

export type RecordFormErrors = Partial<
  Record<'distance' | 'duration' | 'runDate' | 'title', string>
>;

export type RecordValues = {
  category: DistanceCategory;
  distanceM: number;
  durationSec: number;
  runDate: string;
  kind: RunKind;
  title: string | null;
};

/** 비어 있는 폼인가 (S-005 [저장하고 계속] 비활성 조건) */
export const isRecordFormEmpty = (f: RecordFormState) =>
  f.category === null && !f.duration.h && !f.duration.m && !f.duration.s && !f.title.trim();

/**
 * 검증 (PRD 4.4): 기타 1.0~100.0km·0.1 단위, 0초 불가, 페이스 2'30"~20'00"/km, 날짜 1990-01-01~오늘, 제목 40자.
 * 서버도 같은 공유 규칙(recordShapeIssues)으로 다시 검증한다.
 */
export function validateRecordForm(
  f: RecordFormState,
  today: string,
): { errors: RecordFormErrors; values: RecordValues | null } {
  const errors: RecordFormErrors = {};
  let distanceM: number | null = null;
  if (f.category === null) {
    errors.distance = '거리를 골라주세요';
  } else if (f.category === 'other') {
    const km = Number(f.otherKm);
    if (!/^\d{1,3}(\.\d)?$/.test(f.otherKm.trim()) || km < 1 || km > 100) {
      errors.distance = '1.0~100.0km 사이로 입력해주세요';
    } else {
      distanceM = Math.round(km * 10) * 100;
    }
  } else {
    distanceM = STANDARD_DISTANCE_M[f.category];
  }

  const durationSec = hmsToSec(f.duration.h, f.duration.m, f.duration.s);
  if (durationSec === null || durationSec === 0) {
    errors.duration = '기록을 입력해주세요';
  } else if (distanceM !== null && f.category !== null) {
    const issue = recordShapeIssues({ category: f.category, distanceM, durationSec })[0];
    if (issue?.code === 'pace_out_of_range') errors.duration = '기록을 다시 확인해주세요';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.runDate) || Number.isNaN(Date.parse(f.runDate))) {
    errors.runDate = '날짜를 YYYY-MM-DD 형식으로 입력해주세요';
  } else if (f.runDate < RECORD_MIN_DATE || f.runDate > today) {
    errors.runDate = '1990-01-01부터 오늘까지 고를 수 있어요';
  }

  const title = f.title.trim();
  if ([...title].length > 40) errors.title = '40자까지 입력할 수 있어요';

  if (Object.keys(errors).length > 0 || f.category === null || distanceM === null || !durationSec) {
    return { errors, values: null };
  }
  return {
    errors,
    values: {
      category: f.category,
      distanceM,
      durationSec,
      runDate: f.runDate,
      kind: f.kind,
      title: title === '' ? null : title,
    },
  };
}
