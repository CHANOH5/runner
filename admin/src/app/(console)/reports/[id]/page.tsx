'use client';

import { AdminReportDetail, type AdminRace } from '@berun/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { RejectModal, type RejectReason } from '@/components/reject-modal';
import { useSession } from '@/components/session';
import { ErrorAlert, Toast } from '@/components/ui';
import { api } from '@/lib/api';
import {
  formatDate,
  number,
  REGION_LABELS,
  REPORT_FIELD_LABELS,
  shortDateTime,
  STATUS_LABELS,
} from '@/lib/format';
import { errorMessage } from '@/lib/messages';

type Detail = z.infer<typeof AdminReportDetail>;
const Resolved = z.object({ resolved: z.number().int() });
const STATUS_TEXT = { open: '미처리', applied: '반영', rejected: '반려' } as const;

/** 대회 현재 값 — 제보 항목에 해당하는 줄을 강조한다 */
function raceRows(race: AdminRace): [string, string, ReactNode][] {
  const won = (n: number | null) => (n == null ? '—' : `${number(n)}원`);
  return [
    ['date', '대회일', formatDate(race.raceDate)],
    ['venue', '장소', [race.venueName, race.venueAddress].filter(Boolean).join(' · ') || '—'],
    ['venue', '지역', REGION_LABELS[race.regionCode]],
    [
      'events',
      '종목',
      race.events.map((e) => `${e.name} ${number(e.distanceM)}m`).join(', ') || '—',
    ],
    ['fee', '참가비', race.events.map((e) => `${e.name} ${won(e.feeKrw)}`).join(', ') || '—'],
    [
      'registration',
      '접수 기간',
      `${shortDateTime(race.registrationOpensAt)} ~ ${shortDateTime(race.registrationClosesAt)}`,
    ],
    [
      'links',
      '링크',
      race.officialUrl ? (
        <a href={race.officialUrl} target="_blank" rel="noreferrer">
          {race.officialUrl}
        </a>
      ) : (
        '—'
      ),
    ],
    ['status', '상태', STATUS_LABELS[race.status]],
  ];
}

/** A-004 제보 상세 (PRD 8.5) */
export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { admin } = useSession();
  const canWrite = admin.role !== 'viewer';
  const [data, setData] = useState<Detail | null>(null);
  const [also, setAlso] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api('GET', `/reports/${id}`, { schema: AdminReportDetail });
      setData(d);
      // 같은 항목의 다른 미처리 제보는 기본으로 함께 처리 (PRD 8.5)
      setAlso(new Set(d.otherOpenReports.filter((o) => o.field === d.field).map((o) => o.id)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (action: 'applied' | 'rejected', reason?: RejectReason, text?: string) => {
    setRejecting(false);
    setError(null);
    try {
      const res = await api('POST', '/reports/resolve', {
        body: {
          ids: [id, ...also],
          action,
          ...(reason && { rejectReason: reason }),
          ...(text && { rejectText: text }),
        },
        schema: Resolved,
      });
      setToast(
        `${res.resolved}건 ${action === 'applied' ? '반영' : '반려'} · 제보자에게 알림을 보냈어요`,
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (error && !data) return <ErrorAlert message={error} />;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const open = data.status === 'open';
  const count = 1 + also.size;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted">
            <Link href="/reports">오류 제보</Link> /
          </div>
          <h1>{data.raceName}</h1>
        </div>
        {open && canWrite && (
          <div className="actions">
            <a className="btn" href={`/races/${data.raceId}`} target="_blank" rel="noreferrer">
              반영 (수정 폼 새 탭)
            </a>
            <button type="button" className="btn primary" onClick={() => void resolve('applied')}>
              반영 완료{count > 1 ? ` (${count}건)` : ''}
            </button>
            <button type="button" className="btn" onClick={() => setRejecting(true)}>
              반려{count > 1 ? ` (${count}건)` : ''}
            </button>
          </div>
        )}
      </div>
      <ErrorAlert message={error} />
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className={`badge ${open ? (data.overdue72h ? 'danger' : '') : 'ok'}`}>
            {STATUS_TEXT[data.status]}
          </span>
          {open && data.overdue72h && <span className="badge danger">72시간 경과</span>}
          <span className="muted">
            {data.field ? (REPORT_FIELD_LABELS[data.field] ?? data.field) : '항목 없음'} ·{' '}
            {shortDateTime(data.createdAt)} · {data.reporterNickname ?? '탈퇴한 사용자'}
          </span>
        </div>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{data.message}</p>
        {data.resolutionNote && <p className="muted">반려 사유: {data.resolutionNote}</p>}
        {data.resolvedAt && <p className="muted">처리: {shortDateTime(data.resolvedAt)}</p>}
      </div>

      <h2>대회 현재 값</h2>
      <div className="card flush">
        <table className="table">
          <tbody>
            {raceRows(data.race).map(([field, label, value]) => (
              <tr key={label} className={field === data.field ? 'highlight' : ''}>
                <th style={{ width: 120 }}>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.otherOpenReports.length > 0 && (
        <>
          <h2>같은 대회의 다른 미처리 제보</h2>
          <div className="card flush">
            <table className="table">
              <tbody>
                {data.otherOpenReports.map((o) => (
                  <tr key={o.id}>
                    {open && canWrite && (
                      <td style={{ width: 120 }}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={also.has(o.id)}
                            onChange={() =>
                              setAlso((s) => {
                                const n = new Set(s);
                                if (n.has(o.id)) n.delete(o.id);
                                else n.add(o.id);
                                return n;
                              })
                            }
                          />
                          함께 처리
                        </label>
                      </td>
                    )}
                    <td style={{ width: 100 }}>
                      {o.field ? (REPORT_FIELD_LABELS[o.field] ?? o.field) : '—'}
                    </td>
                    <td>
                      <Link href={`/reports/${o.id}`}>{o.preview}</Link>
                    </td>
                    <td style={{ width: 120 }}>{shortDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {rejecting && (
        <RejectModal
          count={count}
          onClose={() => setRejecting(false)}
          onSubmit={(r, t) => void resolve('rejected', r, t)}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
