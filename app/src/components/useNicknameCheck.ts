import { useEffect, useState } from 'react';
import { api } from '../api';
import { nicknameFormatError } from '../features/profile';

export type NicknameCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'error'; message: string };

const MESSAGES = {
  taken: '이미 사용 중이에요',
  forbidden: '사용할 수 없는 닉네임이에요',
  invalid_format: '한글·영문·숫자·_·.만 쓸 수 있어요 (공백 불가)',
} as const;

/** 입력이 멈추고 500ms 뒤 자동 중복 확인 (PRD 4.3) */
export function useNicknameCheck(nickname: string, opts: { signupToken?: string; skip?: boolean }) {
  const [check, setCheck] = useState<NicknameCheck>({ state: 'idle' });
  const { signupToken, skip } = opts;
  useEffect(() => {
    const v = nickname.trim();
    const formatError = nicknameFormatError(v);
    if (skip || v === '') {
      setCheck({ state: 'idle' });
      return;
    }
    if (formatError) {
      setCheck({ state: 'error', message: formatError });
      return;
    }
    setCheck({ state: 'checking' });
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .nicknameAvailability(v, signupToken)
        .then((r) => {
          if (cancelled) return;
          setCheck(
            r.result === 'available'
              ? { state: 'available' }
              : { state: 'error', message: MESSAGES[r.result] },
          );
        })
        .catch(() => {
          if (!cancelled) setCheck({ state: 'idle' });
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [nickname, signupToken, skip]);
  return [check, setCheck] as const;
}
