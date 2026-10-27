import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * 개인정보 처리방침 주소 (S-003 링크, S-065 행 — PRD v1.11 4.2): 원격 설정 `privacyPolicyUrl`.
 * 값이 null이면(개발 환경) '개인정보 수집·이용 동의' 전문 주소(fallback)를 쓴다.
 */
export function usePrivacyPolicyUrl(fallback: string | null | undefined): string | null {
  const cfg = useQuery({ queryKey: ['app-config'], queryFn: api.appConfig });
  return cfg.data?.privacyPolicyUrl ?? fallback ?? null;
}
