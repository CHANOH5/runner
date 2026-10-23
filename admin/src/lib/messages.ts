import type { PublishMissing } from '@berun/shared';
import { ApiError } from './api';

/**
 * 서버 에러 코드 → 화면 문구 (tech/06 3.2). 서버 message(개발자용 영문)는 보여주지 않는다.
 */
const CODE_MESSAGES: Record<string, string> = {
  NETWORK: '서버에 연결하지 못했어요. 네트워크와 API 서버 실행 상태를 확인해주세요.',
  UNAUTHENTICATED: '로그인이 필요하거나 세션이 만료됐어요. 다시 로그인해주세요.',
  FORBIDDEN: '이 작업을 할 권한이 없어요.',
  NOT_FOUND: '삭제되었거나 찾을 수 없는 항목이에요.',
  VALIDATION_FAILED: '입력값을 확인해주세요.',
  CONFLICT_STALE: '다른 곳에서 먼저 수정됐어요. 새로고침한 뒤 다시 저장해주세요.',
  RACE_IN_USE: '관심·참가 예정 사용자가 있어 할 수 없어요. 대신 상태를 "취소"로 바꿔주세요.',
  PUBLISH_REQUIREMENTS_UNMET: '게시할 수 없어요. 아래 항목을 채워주세요.',
  RATE_LIMITED: '잠시 후 다시 시도해주세요.',
  INTERNAL: '서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
  MAINTENANCE: '점검 중이에요.',
};

/** 로그인 화면 전용 (A-001) */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RATE_LIMITED' && typeof err.details?.lockedUntil === 'string') {
      return `로그인을 5회 실패해 15분 동안 잠겼어요. ${hhmm(err.details.lockedUntil)} 이후 다시 시도하세요.`;
    }
    if (err.code === 'UNAUTHENTICATED') {
      return err.message.includes('totp') || err.message.includes('mfa')
        ? '인증 코드가 맞지 않거나 시간이 지났어요. 처음부터 다시 시도하려면 [처음으로]를 누르세요.'
        : '이메일 또는 비밀번호가 맞지 않아요.';
    }
  }
  return errorMessage(err);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError)
    return CODE_MESSAGES[err.code] ?? `요청을 처리하지 못했어요 (${err.code}).`;
  return '알 수 없는 오류가 생겼어요.';
}

/** 입력란별 fieldErrors 코드 → 문구 */
const FIELD_CODE_MESSAGES: Record<string, string> = {
  required: '필수 항목이에요',
  too_short: '너무 짧아요',
  too_long: '너무 길어요',
  out_of_range: '허용 범위를 벗어났어요',
  invalid_format: '형식이 맞지 않아요',
  invalid_value: '값을 확인해주세요',
  invalid_type: '값을 확인해주세요',
  before_opens_at: '마감은 오픈보다 뒤여야 해요',
  after_race_date: '대회일 전이어야 해요',
  event_in_use: '참가 예정자가 있는 종목은 삭제할 수 없어요',
  publish_requires_road:
    '게시 중인 대회는 종류를 바꿀 수 없어요. 먼저 숨김 또는 게시 취소를 해주세요',
  taken: '이미 사용 중이에요',
  last_owner: '마지막 owner는 바꿀 수 없어요',
  self: '자기 자신은 비활성화할 수 없어요',
};
export const fieldMessage = (code: string) => FIELD_CODE_MESSAGES[code] ?? '값을 확인해주세요';

/** path → 입력란 이름 (에러 목록 표시용) */
const FIELD_LABELS: Record<string, string> = {
  name: '대회명',
  raceDate: '대회일',
  regionCode: '지역',
  slug: '슬러그',
  registrationOpensAt: '접수 오픈',
  registrationClosesAt: '접수 마감',
  officialUrl: '공식 홈페이지 URL',
  registrationUrl: '접수 URL',
  courseUrl: '코스 안내 URL',
  venuePoint: '좌표',
  'venuePoint.lat': '위도',
  'venuePoint.lng': '경도',
  raceType: '대회 종류',
  events: '종목',
  'if-match': '수정 기준 시각',
};
export function fieldLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const m = /^events\[(\d+)\]\.?(.*)$/.exec(path);
  if (m) {
    const sub: Record<string, string> = {
      name: '종목명',
      distanceM: '거리',
      startTime: '출발',
      timeLimitMin: '제한 시간',
      feeKrw: '참가비',
      capacity: '정원',
      registrationOpensAt: '종목 접수 오픈',
      registrationClosesAt: '종목 접수 마감',
    };
    return `종목 ${Number(m[1]) + 1}${m[2] ? ` ${sub[m[2]] ?? m[2]}` : ''}`;
  }
  return path;
}

/** 게시 조건 미충족 항목 (PRD 8.4.2) */
export const PUBLISH_MISSING_LABELS: Record<PublishMissing, string> = {
  name: '대회명',
  raceDate: '대회일',
  regionCode: '지역',
  officialUrl: '공식 홈페이지 URL',
  primarySourceVerified: '대표 출처 확인 — [확인 완료 — 오늘로 갱신] 체크',
  events: '종목 1개 이상 (종목명·분류·거리)',
  eventFields: '종목명·분류·거리',
  raceTypeRoad: '대회 종류 = 도로 (Phase 1은 도로 대회만)',
  lastVerifiedAt: '최종 확인일 — [확인 완료 — 오늘로 갱신] 체크',
};

function hhmm(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  });
}
