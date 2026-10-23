'use client';

import { AdminRacePage, AdminReportPage } from '@berun/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ComingSoon, ErrorAlert } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { todayKst, number } from '@/lib/format';
import { errorMessage } from '@/lib/messages';

type Stats = {
  publishedUpcoming: number;
  drafts: number;
  staleVerified: number;
  noCoords: number;
  openReports: number;
  overdueReports: number;
};

/**
 * A-002 (PRD 8.3). 대시보드 전용 API(GET /dashboard)는 아직 없어, 있는 목록 API로 셀 수 있는 것만 보여준다.
 * 사용자·알림·입력 진행·이번 주 접수 오픈은 준비 중.
 */
async function loadStats(): Promise<Stats> {
  const total = async (params: Parameters<typeof qs>[0]) =>
    (await api('GET', `/races${qs({ ...params, pageSize: 1 })}`, { schema: AdminRacePage })).total;
  const [publishedUpcoming, drafts, staleVerified, noCoords, reports] = await Promise.all([
    total({ publishStatus: ['published'], from: todayKst() }),
    total({ publishStatus: ['draft'] }),
    total({ staleVerified: true }),
    total({ noCoords: true }),
    api('GET', `/reports${qs({ status: ['open'], pageSize: 100 })}`, { schema: AdminReportPage }),
  ]);
  return {
    publishedUpcoming,
    drafts,
    staleVerified,
    noCoords,
    openReports: reports.total,
    overdueReports: reports.items.filter((r) => r.overdue72h).length,
  };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats()
      .then(setStats)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const n = (v: number | undefined) =>
    v === undefined ? (
      <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 28 }} />
    ) : (
      number(v)
    );

  return (
    <>
      <div className="page-head">
        <h1>대시보드</h1>
      </div>
      <ErrorAlert message={error} />
      <div className="grid-cards">
        <section className="card">
          <h2>대회</h2>
          <div className="stat">{n(stats?.publishedUpcoming)}</div>
          <div className="muted">게시된 예정 대회 · 초안 {stats ? number(stats.drafts) : '…'}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Link href="/races?staleVerified=true">
              최종 확인 30일 경과 {stats ? number(stats.staleVerified) : '…'}
            </Link>
            <span className="muted">·</span>
            <Link href="/races?noCoords=true">
              좌표 없음 {stats ? number(stats.noCoords) : '…'}
            </Link>
          </div>
        </section>
        <section className="card">
          <h2>오류 제보</h2>
          <div className="stat">{n(stats?.openReports)}</div>
          <div className="muted">
            미처리 ·{' '}
            <span style={{ color: stats?.overdueReports ? 'var(--danger)' : undefined }}>
              72시간 경과 {stats ? number(stats.overdueReports) : '…'}
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <Link href="/reports">제보 처리하기 →</Link>
          </div>
        </section>
        <section className="card">
          <h2>사용자</h2>
          <ComingSoon what="오늘·7일 신규 가입, DAU·WAU (대시보드 API)" />
        </section>
        <section className="card">
          <h2>알림</h2>
          <ComingSoon what="오늘 발송·실패, N-02 정시 발송률 (D-018 기준)" />
        </section>
        <section className="card">
          <h2>입력 진행</h2>
          <ComingSoon what="게시 수 / 목표 수 (owner가 목표 설정)" />
        </section>
        <section className="card">
          <h2>이번 주 접수 오픈</h2>
          <ComingSoon what="7일 안 오픈 대회와 관심 수" />
        </section>
      </div>
    </>
  );
}
