import { create } from 'zustand';
import type { Gate } from '../api/client';

export type SignupDraft = {
  token: string;
  expiresAt: string;
  /** S-003에서 고른 약관 id (S-004 완료 시 함께 보낸다, PRD 4.2) */
  agreedTermIds: string[];
  marketing: boolean;
  /** 분석용 (signup_completed): 로그인을 시작한 provider와 시각 */
  provider?: 'kakao' | 'apple' | 'google';
  startedAt?: number;
};

type SessionState = {
  /** booting: 스플래시 판단 중 */
  status: 'booting' | 'signedOut' | 'signedIn';
  /** 강제 업데이트·재동의·점검 (API 426·403 TERMS_REQUIRED·503) */
  gate: Gate | null;
  signup: SignupDraft | null;
  /** 이번 로그인으로 휴면이 해제됨 → 안내 화면 1회 (PRD 4.1) */
  reactivated: boolean;
  setStatus: (status: SessionState['status']) => void;
  setGate: (gate: Gate | null) => void;
  setSignup: (signup: SignupDraft | null) => void;
  setReactivated: (v: boolean) => void;
};

export const useSession = create<SessionState>((set) => ({
  status: 'booting',
  gate: null,
  signup: null,
  reactivated: false,
  setStatus: (status) => set({ status }),
  setGate: (gate) => set({ gate }),
  setSignup: (signup) => set({ signup }),
  setReactivated: (reactivated) => set({ reactivated }),
}));
