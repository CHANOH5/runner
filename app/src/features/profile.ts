import { MIN_BIRTH_YEAR, MIN_RUNNING_SINCE, NICKNAME_PATTERN, REGION_CODES } from '@berun/shared';
import { REGION_LABELS } from '../lib/format';

/** 만 14세 판정 (PRD 4.3, P-ACC-01): 차이 ≥ 15 통과 / ≤ 13 중단 / = 14 생일 질문 */
export function ageGate(birthYear: number, thisYear: number): 'ok' | 'underage' | 'ask' {
  const diff = thisYear - birthYear;
  if (diff >= 15) return 'ok';
  if (diff <= 13) return 'underage';
  return 'ask';
}

/** 닉네임 형식 (서버 Nickname 스키마와 같은 규칙, 코드포인트 길이) — 중복·금칙어는 서버 확인 */
export function nicknameFormatError(raw: string): string | null {
  const v = raw.trim();
  const len = [...v].length;
  if (len === 0) return null;
  if (len < 2 || len > 12) return '2~12자로 입력해주세요';
  if (!NICKNAME_PATTERN.test(v)) return '한글·영문·숫자·_·.만 쓸 수 있어요 (공백 불가)';
  return null;
}

/** 러닝 시작 연도: 출생연도 + 5 이상 (PRD 4.3) */
export function runningSinceError(runningSince: number | null, birthYear: number | null) {
  if (runningSince === null || birthYear === null) return null;
  return runningSince < birthYear + 5 ? '출생연도보다 5년 이후로 골라주세요' : null;
}

export const birthYearOptions = (thisYear: number) =>
  Array.from({ length: thisYear - MIN_BIRTH_YEAR + 1 }, (_, i) => thisYear - i).map((y) => ({
    value: y,
    label: `${y}년`,
  }));

export const runningSinceOptions = (thisYear: number) => [
  { value: null, label: '선택 안 함' },
  ...Array.from({ length: thisYear - MIN_RUNNING_SINCE + 1 }, (_, i) => thisYear - i).map((y) => ({
    value: y,
    label: `${y}년`,
  })),
];

export const regionOptions = REGION_CODES.map((code) => ({
  value: code,
  label: REGION_LABELS[code],
}));
