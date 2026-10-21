/**
 * 닉네임 금칙어·예약어 (PRD 4.3). 부분 일치, 대소문자 무시.
 * 욕설 목록은 운영 정책 확정 후 이 파일에 추가한다 (관리자 UI는 Phase 2).
 */
export const RESERVED_WORDS = [
  'berun',
  '비런',
  'admin',
  '관리자',
  '운영자',
  '운영진',
  '공식',
  'official',
  'staff',
];

export const PROFANITY_WORDS: string[] = [];

export function isForbiddenNickname(nickname: string): boolean {
  const n = nickname.toLowerCase();
  return [...RESERVED_WORDS, ...PROFANITY_WORDS].some((w) => n.includes(w.toLowerCase()));
}
