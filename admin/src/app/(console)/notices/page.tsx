'use client';

import { AdminNotice, AdminNoticePage } from '@berun/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/components/session';
import { ErrorAlert, Modal, Toast } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { number, shortDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/messages';
import { adminAnalytics } from '@/lib/analytics';

const STATUS: Record<AdminNotice['status'], { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: '' },
  approved: { label: '예약됨', cls: 'info' },
  sent: { label: '발송됨', cls: 'ok' },
  withdrawn: { label: '내림', cls: 'danger' },
};

/** A-008 공지 목록 (PRD 8.6): 발송 통계(발송·성공·실패·열람), 승인 대기, 앱 내 공지 내리기 */
export default function NoticesPage() {
  const { admin } = useSession();
  const canWrite = admin.role !== 'viewer';
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminNoticePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<AdminNotice | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        await api('GET', `/notices${qs({ page, pageSize: 50 })}`, { schema: AdminNoticePage }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (n: AdminNotice, action: 'approve' | 'withdraw') => {
    setWithdrawing(null);
    try {
      const updated = await api('POST', `/notices/${n.id}/${action}`, { schema: AdminNotice });
      if (action === 'withdraw') {
        adminAnalytics.track('admin_notice_withdrawn', { notice_id: n.id, status: n.status });
      } else {
        adminAnalytics.track('admin_notice_approved', {
          notice_id: n.id,
          kind: updated.kind,
          recipients: updated.stats.recipients,
          scheduled: updated.scheduledAt !== null,
        });
      }
      setToast(action === 'approve' ? '승인했어요' : '앱 내 공지를 내렸어요');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const items = data?.items ?? [];
  return (
    <>
      <div className="page-head">
        <h1>공지·푸시</h1>
        {canWrite && (
          <Link className="btn primary" href="/notices/new">
            새 공지
          </Link>
        )}
      </div>
      <ErrorAlert message={error} />
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>제목</th>
              <th>종류</th>
              <th>상태</th>
              <th>발송 시각</th>
              <th className="num">발송</th>
              <th className="num">성공</th>
              <th className="num">실패</th>
              <th className="num">열람</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id}>
                <td>
                  <Link href={`/notices/${n.id}`}>{n.displayTitle}</Link>
                  {n.status === 'draft' && n.createdBy.email && (
                    <div className="muted">{n.createdBy.email} 작성</div>
                  )}
                </td>
                <td>{n.kind === 'marketing' ? '마케팅' : '공지'}</td>
                <td>
                  <span className={`badge ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>
                  {n.status === 'draft' && <div className="muted">승인 대기</div>}
                </td>
                <td>{shortDateTime(n.publishedAt ?? n.scheduledAt)}</td>
                <td className="num">{number(n.stats.recipients)}</td>
                <td className="num">{number(n.stats.pushed + n.stats.inAppOnly)}</td>
                <td className="num">{number(n.stats.failed)}</td>
                <td className="num">{number(n.stats.opened)}</td>
                <td>
                  {admin.role === 'owner' && n.status === 'draft' && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => void act(n, 'approve')}
                    >
                      발송 승인
                    </button>
                  )}
                  {canWrite && (n.status === 'sent' || n.status === 'approved') && (
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => setWithdrawing(n)}
                    >
                      {n.status === 'sent' ? '앱 내 공지 내리기' : '예약 취소(내리기)'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  아직 공지가 없어요
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data && data.total > data.pageSize && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button
              type="button"
              className="btn small"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <button
              type="button"
              className="btn small"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        )}
        <p className="muted">
          성공 = 푸시 전달 + 앱 내 공지만(기기 없음). 대회 취소·연기·일정 변경 알림(N-06)은 대회
          수정 화면에서 저장할 때 보내요.
        </p>
      </div>
      {withdrawing && (
        <Modal
          title="앱 내 공지 내리기"
          onClose={() => setWithdrawing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setWithdrawing(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => void act(withdrawing, 'withdraw')}
              >
                내리기
              </button>
            </>
          }
        >
          <p>
            &quot;{withdrawing.displayTitle}&quot;을 내릴까요? 앱의 공지 상세는 &quot;내려간
            공지예요&quot;로 바뀌고, 아직 보내지 않은 푸시는 취소돼요. 되돌릴 수 없어요.
          </p>
        </Modal>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
