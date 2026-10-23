'use client';

import { AdminReportPage } from '@berun/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { RejectModal, type RejectReason } from '@/components/reject-modal';
import { useSession } from '@/components/session';
import { ErrorAlert, Toast } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { number, REPORT_FIELD_LABELS, shortDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/messages';

type Page = z.infer<typeof AdminReportPage>;
const TABS = [
  ['open', '미처리'],
  ['applied', '반영'],
  ['rejected', '반려'],
] as const;
const STATUS_TEXT = { open: '미처리', applied: '반영', rejected: '반려' } as const;
const Resolved = z.object({ resolved: z.number().int() });

/** A-004 제보 목록 (PRD 8.5): 접수 오래된 순, 72시간 경과 강조, 일괄 반영·반려 */
export default function ReportsPage() {
  const { admin } = useSession();
  const canWrite = admin.role !== 'viewer';
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        await api('GET', `/reports${qs({ status: [tab], page, pageSize: 50 })}`, {
          schema: AdminReportPage,
        }),
      );
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab, page]);
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (action: 'applied' | 'rejected', reason?: RejectReason, text?: string) => {
    setRejecting(false);
    try {
      const res = await api('POST', '/reports/resolve', {
        body: {
          ids: [...selected],
          action,
          ...(reason && { rejectReason: reason }),
          ...(text && { rejectText: text }),
        },
        schema: Resolved,
      });
      setToast(
        `${res.resolved}건을 ${action === 'applied' ? '반영' : '반려'} 처리했어요 · 제보자에게 각각 알림`,
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const items = data?.items ?? [];

  return (
    <>
      <div className="page-head">
        <h1>오류 제보</h1>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
          >
            {label}
            {tab === k && data ? ` ${number(data.total)}` : ''}
          </button>
        ))}
      </div>
      <ErrorAlert message={error} />
      {tab === 'open' && canWrite && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted">선택 {selected.size}건</span>
          <button
            type="button"
            className="btn small"
            disabled={!selected.size}
            onClick={() => void resolve('applied')}
          >
            반영 완료
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!selected.size}
            onClick={() => setRejecting(true)}
          >
            반려
          </button>
        </div>
      )}
      <div className="card flush">
        <table className="table">
          <thead>
            <tr>
              {tab === 'open' && canWrite && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="모두 선택"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                    }
                  />
                </th>
              )}
              <th>대회명</th>
              <th>항목</th>
              <th>내용</th>
              <th>접수</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {data && items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  {tab === 'open' ? '미처리 제보가 없어요' : '제보가 없어요'}
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.id} className={r.overdue72h && r.status === 'open' ? 'overdue' : ''}>
                {tab === 'open' && canWrite && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`선택 ${r.raceName}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td>
                  <Link href={`/reports/${r.id}`}>{r.raceName}</Link>
                </td>
                <td>{r.field ? (REPORT_FIELD_LABELS[r.field] ?? r.field) : '—'}</td>
                <td className="muted">{r.preview}</td>
                <td>
                  {shortDateTime(r.createdAt)}
                  {r.overdue72h && r.status === 'open' && (
                    <span className="badge danger" style={{ marginLeft: 6 }}>
                      72시간 경과
                    </span>
                  )}
                </td>
                <td>{STATUS_TEXT[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > data.pageSize && (
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn small"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            이전
          </button>
          <span className="muted">
            {page} / {Math.ceil(data.total / data.pageSize)}
          </span>
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
      {rejecting && (
        <RejectModal
          count={selected.size}
          onClose={() => setRejecting(false)}
          onSubmit={(r, t) => void resolve('rejected', r, t)}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
