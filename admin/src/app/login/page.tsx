'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  // 같은 사이트 경로만 허용 (열린 리디렉트 방지)
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return (
    <div className="login-wrap">
      <LoginForm onDone={() => router.replace(target)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
