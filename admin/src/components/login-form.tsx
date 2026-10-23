'use client';

import { AdminLoginRes, AdminMfaRes } from '@berun/shared';
import { useState, type FormEvent } from 'react';
import { api, setCsrfToken } from '@/lib/api';
import { loginErrorMessage } from '@/lib/messages';

/**
 * A-001: 1단계 이메일 + 비밀번호 → 2단계 TOTP 6자리 → 세션 쿠키 (PRD 8.2, tech/06 2.3).
 * 성공하면 onDone(이동할 경로).
 */
export function LoginForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('POST', '/auth/login', {
        body: { email, password },
        schema: AdminLoginRes,
      });
      setMfaToken(res.mfaToken);
      setPassword('');
      setStep('totp');
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('POST', '/auth/mfa', { body: { mfaToken, totp }, schema: AdminMfaRes });
      setCsrfToken(res.csrfToken);
      onDone();
    } catch (err) {
      setError(loginErrorMessage(err));
      setTotp('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card login-card">
      <div className="hint">BeRun 관리자</div>
      {step === 'password' ? (
        <>
          <h1>관리자 로그인</h1>
          <form onSubmit={(e) => void submitPassword(e)}>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <label>
              이메일
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? '확인 중…' : '다음'}
            </button>
          </form>
        </>
      ) : (
        <>
          <h1>2단계 인증</h1>
          <p className="muted">인증 앱의 6자리 코드를 입력하세요</p>
          <form onSubmit={(e) => void submitTotp(e)}>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <label>
              인증 코드
              <input
                className="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy || totp.length !== 6}>
              {busy ? '확인 중…' : '로그인'}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setStep('password');
                setError(null);
                setTotp('');
              }}
            >
              처음으로
            </button>
          </form>
        </>
      )}
      <p className="hint" style={{ marginTop: 16 }}>
        세션 8시간 · 30분 동안 사용하지 않으면 로그아웃돼요
      </p>
    </div>
  );
}
