'use client';

import { AdminSessionInfo, type AdminMe } from '@berun/shared';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import { adminAnalytics } from '@/lib/analytics';

type Session = { admin: AdminMe; logout: () => Promise<void> };
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** 서버 세션(쿠키) 확인 → CSRF 토큰 복구. 없거나 만료면 로그인 화면으로 (PRD 8.2) */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe | null>(null);

  useEffect(() => {
    let alive = true;
    api('GET', '/auth/me', { schema: AdminSessionInfo })
      .then(({ csrfToken, ...me }) => {
        if (!alive) return;
        setCsrfToken(csrfToken);
        adminAnalytics.identify(me.id);
        setAdmin(me);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      });
    return () => {
      alive = false;
    };
  }, [router, pathname]);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    setCsrfToken(null);
    adminAnalytics.reset();
    router.replace('/login');
  }, [router]);

  if (!admin) {
    return (
      <div className="login-wrap">
        <div className="skeleton" style={{ width: 200 }} />
      </div>
    );
  }
  return <SessionContext.Provider value={{ admin, logout }}>{children}</SessionContext.Provider>;
}
