'use client';

import type { AdminNotice } from '@berun/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NoticeFormView } from '@/components/notice-form';
import { useSession } from '@/components/session';

/**
 * A-008 새 공지. 처음 저장해도 폼을 다시 그리지 않는다 — [발송]은 저장 → 확인 모달 → 승인이 이어지므로
 * 주소만 바꾸고(history.replaceState), 승인 뒤에 공지 화면으로 옮긴다.
 */
export default function NewNoticePage() {
  const router = useRouter();
  const { admin } = useSession();
  const [created, setCreated] = useState<AdminNotice | null>(null);
  return (
    <>
      <div className="page-head">
        <h1>공지 · 푸시 작성</h1>
      </div>
      <NoticeFormView
        notice={created}
        role={admin.role}
        onSaved={(n) => {
          setCreated(n);
          if (n.status === 'draft') window.history.replaceState(null, '', `/notices/${n.id}`);
          else router.replace(`/notices/${n.id}`);
        }}
      />
    </>
  );
}
