'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from '@/components/session';

const NAV = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/races', label: '대회' },
  { href: '/reports', label: '오류 제보' },
  { href: '/notices', label: '공지·푸시' },
];
const LATER = ['참가 인증 (Phase 2)', '신고 처리 (Phase 2)', '위치정보 요청 (Phase 3)'];

function Shell({ children }: { children: ReactNode }) {
  const { admin, logout } = useSession();
  const pathname = usePathname();
  return (
    <>
      <header className="topbar">
        <div className="brand">
          BeRun 관리자<small>Phase 1</small>
        </div>
        <div className="who">
          <span>
            {admin.role} · {admin.email}
          </span>
          <button className="btn small" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </header>
      <div className="shell">
        <nav className="sidenav" aria-label="메뉴">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={pathname.startsWith(n.href) ? 'active' : ''}
            >
              {n.label}
            </Link>
          ))}
          <hr />
          {LATER.map((l) => (
            <span key={l} className="disabled">
              {l}
            </span>
          ))}
        </nav>
        <main className="main">{children}</main>
      </div>
    </>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
