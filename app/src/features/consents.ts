import { formatDotDate } from '../lib/format';

/** 마케팅 동의·철회 날짜 토스트 (PRD 4.14) */
export function marketingToast(on: boolean, at: string | null) {
  const date = formatDotDate(at ?? new Date().toISOString());
  return on
    ? `${date} 마케팅 정보 수신에 동의했어요`
    : `${date} 마케팅 정보 수신 동의를 철회했어요`;
}
