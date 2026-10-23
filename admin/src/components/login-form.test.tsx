import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '@/test/fetch-mock';
import { LoginForm } from './login-form';

afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: '0199f000-0000-7000-8000-000000000901',
  email: 'dev-owner@example.com',
  role: 'owner',
};

describe('A-001 로그인', () => {
  it('비밀번호 → TOTP → 세션, 이후 쓰기 요청에 CSRF 토큰을 붙인다', async () => {
    const calls = mockFetch(({ method, path }) => {
      if (method === 'POST' && path === '/auth/login')
        return { body: { mfaRequired: true, mfaToken: 'mfa-1' } };
      if (method === 'POST' && path === '/auth/mfa')
        return { body: { admin, csrfToken: 'csrf-1' } };
      if (method === 'POST' && path === '/auth/logout') return { status: 204 };
      return undefined;
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm onDone={onDone} />);

    await user.type(screen.getByLabelText('이메일'), 'dev-owner@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'pw');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await user.type(await screen.findByLabelText('인증 코드'), '123456');
    await user.click(screen.getByRole('button', { name: '로그인' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ email: 'dev-owner@example.com', password: 'pw' });
    expect(calls[1]?.body).toEqual({ mfaToken: 'mfa-1', totp: '123456' });

    const { api } = await import('@/lib/api');
    await api('POST', '/auth/logout');
    expect(calls[2]?.headers['x-csrf-token']).toBe('csrf-1');
  });

  it('틀린 비밀번호와 잠금을 한국어로 보여준다', async () => {
    let n = 0;
    mockFetch(() =>
      ++n === 1
        ? { status: 401, body: apiError('UNAUTHENTICATED') }
        : {
            status: 429,
            body: apiError('RATE_LIMITED', {
              details: { lockedUntil: '2026-10-23T14:45:00+09:00' },
            }),
          },
    );
    const user = userEvent.setup();
    render(<LoginForm onDone={vi.fn()} />);
    await user.type(screen.getByLabelText('이메일'), 'a@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'x');
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호');

    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('14:45 이후 다시 시도하세요');
  });
});
