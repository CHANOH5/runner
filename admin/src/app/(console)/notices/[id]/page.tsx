'use client';

import { AdminNotice } from '@berun/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NoticeFormView } from '@/components/notice-form';
import { useSession } from '@/components/session';
import { ErrorAlert } from '@/components/ui';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { errorMessage } from '@/lib/messages';

const STATUS_TEXT = {
  draft: '작성 중',
  approved: '예약됨',
  sent: '발송됨',
  withdrawn: '내림',
} as const;

/** A-008 공지 수정·발송 결과 */
export default function NoticePage() {
  const { id } = useParams<{ id: string }>();
  const { admin } = useSession();
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNotice(null);
    api('GET', `/notices/${id}`, { schema: AdminNotice })
      .then(setNotice)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [id]);

  if (error) return <ErrorAlert message={error} />;
  if (!notice) return <div className="skeleton" style={{ height: 320 }} />;
  const s = notice.stats;
  return (
    <>
      <div className="page-head">
        <h1>
          공지 · 푸시 <span className="badge">{STATUS_TEXT[notice.status]}</span>
        </h1>
        <Link className="btn small" href="/notices">
          목록
        </Link>
      </div>
      {(notice.status === 'sent' || notice.status === 'withdrawn') && (
        <div className="card" data-testid="notice-stats">
          <div className="row">
            <span>발송 {number(s.recipients)}</span>
            <span>푸시 성공 {number(s.pushed)}</span>
            <span>앱 내만 {number(s.inAppOnly)}</span>
            <span>실패 {number(s.failed)}</span>
            <span>대기 {number(s.pending)}</span>
            <span>열람 {number(s.opened)}</span>
          </div>
        </div>
      )}
      <NoticeFormView
        key={`${notice.id}-${notice.status}`}
        notice={notice}
        role={admin.role}
        onSaved={setNotice}
      />
    </>
  );
}
