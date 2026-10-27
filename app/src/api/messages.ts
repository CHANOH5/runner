import { formatKoreanMonthDay } from '../lib/format';
import { ApiError } from './client';

/**
 * 에러 코드 → 사용자 문구 (tech/06 3.2 "앱 처리" 열, PRD 문구). 서버 message는 표시하지 않는다.
 */
const LIMIT_MESSAGES: Record<string, string> = {
  records: '기록은 500개까지 저장할 수 있어요',
  interests: '관심 대회는 200개까지 저장할 수 있어요. 지난 대회를 정리해주세요',
  registrations: '참가 예정 대회는 30개까지 추가할 수 있어요',
  prediction_records: '기록은 5개까지 고를 수 있어요',
};

const MESSAGES: Record<string, string> = {
  NETWORK: '인터넷 연결을 확인해주세요',
  VALIDATION_FAILED: '입력한 내용을 다시 확인해주세요',
  UNAUTHENTICATED: '다시 로그인해주세요',
  REFRESH_INVALID: '다시 로그인해주세요',
  REFRESH_REUSED: '다시 로그인해주세요',
  SIGNUP_TOKEN_EXPIRED: '시간이 지나 처음부터 다시 진행해주세요',
  SOCIAL_TOKEN_INVALID: '로그인하지 못했어요. 다시 시도해주세요',
  ACCOUNT_SUSPENDED: '이용이 제한된 계정이에요',
  TERMS_REQUIRED: '약관 동의가 필요해요',
  FORBIDDEN: '삭제되었거나 찾을 수 없는 정보예요',
  NOT_FOUND: '삭제되었거나 찾을 수 없는 정보예요',
  NOTICE_WITHDRAWN: '내려간 공지예요',
  RACE_UNAVAILABLE: '더 이상 볼 수 없는 대회예요',
  ALREADY_PLANNED: '이미 참가 예정인 대회예요',
  RACE_CANCELLED: '취소된 대회라 참가 예정에 추가할 수 없어요',
  RACE_FINISHED: '종료된 대회라 바꿀 수 없어요',
  DUPLICATE_RECORD: '같은 기록이 이미 있어요. 그래도 저장할까요?',
  NICKNAME_TAKEN: '이미 사용 중이에요',
  NICKNAME_FORBIDDEN: '사용할 수 없는 닉네임이에요',
  UNDERAGE: 'BeRun은 만 14세 이상부터 이용할 수 있어요.',
  TARGET_DISTANCE_UNSUPPORTED: '이 종목은 예상 기록을 지원하지 않아요',
  NO_ELIGIBLE_RECORDS: '예측하려면 최근 1년 안에 뛴 3km 이상 기록이 필요해요',
  GOAL_OUT_OF_RANGE: '목표 기록을 다시 확인해주세요',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해주세요',
  REPORT_LIMIT_DAILY: '오늘은 더 제보할 수 없어요. 내일 다시 시도해주세요',
  UPGRADE_REQUIRED: '새 버전이 필요해요',
  MAINTENANCE: '잠시 문제가 생겼어요',
  INTERNAL: '잠시 문제가 생겼어요',
};

export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return '잠시 문제가 생겼어요';
  if (err.code === 'LIMIT_EXCEEDED') {
    const resource = typeof err.details.resource === 'string' ? err.details.resource : '';
    return LIMIT_MESSAGES[resource] ?? '더 추가할 수 없어요';
  }
  if (err.code === 'NICKNAME_CHANGE_COOLDOWN' && typeof err.details.availableAt === 'string') {
    return `${formatKoreanMonthDay(err.details.availableAt)}부터 바꿀 수 있어요`;
  }
  return MESSAGES[err.code] ?? '잠시 문제가 생겼어요';
}

/** 저장 동작 실패 토스트 (PRD 3.4): 네트워크는 "저장하지 못했어요…", 그 밖은 코드별 문구 */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'NETWORK')
    return '저장하지 못했어요. 다시 시도해주세요';
  return errorMessage(err);
}

/** 400 fieldErrors → 입력란 아래 문구 (PRD 3.5) */
export function fieldErrorMessage(code: string): string {
  switch (code) {
    case 'required':
      return '필수 항목이에요';
    case 'too_short':
      return '너무 짧아요';
    case 'too_long':
      return '너무 길어요';
    case 'pace_out_of_range':
      return '기록을 다시 확인해주세요';
    case 'out_of_range':
      return '범위를 다시 확인해주세요';
    case 'invalid_format':
      return '형식을 다시 확인해주세요';
    default:
      return '입력한 내용을 다시 확인해주세요';
  }
}

/** 화면 전체 에러 문구 (PRD 3.4): 네트워크 / 404 / 410 / 서버 오류 */
export function screenErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return '인터넷 연결을 확인해주세요';
    if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')
      return '삭제되었거나 찾을 수 없는 정보예요';
    if (err.code === 'RACE_UNAVAILABLE') return '더 이상 볼 수 없는 대회예요';
  }
  return '잠시 문제가 생겼어요';
}
