'use client';

import { AdminRacePage, REGION_CODES } from '@berun/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { cloneAndOpen } from '@/components/clone';
import { ErrorAlert } from '@/components/ui';
import { api, qs } from '@/lib/api';
import {
  formatDate,
  number,
  PUBLISH_LABELS,
  REGION_LABELS,
  shortDate,
  STATUS_LABELS,
} from '@/lib/format';
import { errorMessage } from '@/lib/messages';

type Page = z.infer<typeof AdminRacePage>;
const PAGE_SIZE = 50;

/** A-003 목록 (PRD 8.4): 검색, 필터, 대회일 순, 행마다 [복제] [수정] */
function RaceList() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [publish, setPublish] = useState<string[]>(params.getAll('publishStatus'));
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [region, setRegion] = useState(params.get('region') ?? '');
  const [flags, setFlags] = useState({
    staleVerified: params.get('staleVerified') === 'true',
    noCoords: params.get('noCoords') === 'true',
    publishBlocked: params.get('publishBlocked') === 'true',
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        await api(
          'GET',
          `/races${qs({
            q: q.trim() || undefined,
            publishStatus: publish,
            status: status ? [status] : undefined,
            region: region ? [region] : undefined,
            staleVerified: flags.staleVerified,
            noCoords: flags.noCoords,
            publishBlocked: flags.publishBlocked,
            page,
            pageSize: PAGE_SIZE,
          })}`,
          { schema: AdminRacePage },
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [q, publish, status, region, flags, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const togglePublish = (v: string) => {
    setPage(1);
    setPublish((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };
  const toggleFlag = (k: keyof typeof flags) => {
    setPage(1);
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-head">
        <h1>대회</h1>
        <div className="actions">
          <Link className="btn primary" href="/races/new">
            + 새 대회
          </Link>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <input
            aria-label="대회명 검색"
            placeholder="대회명 검색"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            style={{ width: 260 }}
          />
          <div className="chips">
            {(['published', 'draft', 'hidden'] as const).map((v) => (
              <button
                key={v}
                className="chip"
                aria-pressed={publish.includes(v)}
                onClick={() => togglePublish(v)}
              >
                {PUBLISH_LABELS[v]}
              </button>
            ))}
          </div>
          <select
            aria-label="상태"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">상태 전체</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="지역"
            value={region}
            onChange={(e) => {
              setPage(1);
              setRegion(e.target.value);
            }}
          >
            <option value="">지역 전체</option>
            {REGION_CODES.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
          <div className="chips">
            <button
              className="chip"
              aria-pressed={flags.staleVerified}
              onClick={() => toggleFlag('staleVerified')}
            >
              최종 확인 30일 경과
            </button>
            <button
              className="chip"
              aria-pressed={flags.noCoords}
              onClick={() => toggleFlag('noCoords')}
            >
              좌표 없음
            </button>
            <button
              className="chip"
              aria-pressed={flags.publishBlocked}
              onClick={() => toggleFlag('publishBlocked')}
            >
              게시 조건 미충족
            </button>
          </div>
        </div>
      </div>
      <ErrorAlert message={error} />
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>대회명</th>
              <th>대회일</th>
              <th>지역</th>
              <th>상태</th>
              <th>게시</th>
              <th className="num">관심</th>
              <th className="num">참가</th>
              <th>최종 확인</th>
              <th>수정일</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="wrap">
                  <Link href={`/races/${r.id}`}>{r.name}</Link>
                  {r.publishMissing.length > 0 && r.publishStatus !== 'published' && (
                    <span className="badge warn" style={{ marginLeft: 6 }} title="게시 조건 미충족">
                      조건 미충족
                    </span>
                  )}
                </td>
                <td>{formatDate(r.raceDate)}</td>
                <td>{REGION_LABELS[r.regionCode]}</td>
                <td>
                  <span
                    className={`badge ${r.status === 'cancelled' ? 'danger' : r.status === 'postponed' ? 'warn' : ''}`}
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${r.publishStatus === 'published' ? 'ok' : r.publishStatus === 'hidden' ? 'danger' : ''}`}
                  >
                    {PUBLISH_LABELS[r.publishStatus]}
                  </span>
                </td>
                <td className="num">{number(r.interestCount)}</td>
                <td className="num">{number(r.registrationCount)}</td>
                <td>{shortDate(r.lastVerifiedAt)}</td>
                <td>{shortDate(r.updatedAt)}</td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <button
                      className="btn small"
                      onClick={() =>
                        void cloneAndOpen(r.id, r.name, (u) => router.push(u)).catch(
                          (err: unknown) => setError(errorMessage(err)),
                        )
                      }
                    >
                      복제
                    </button>
                    <Link className="btn small" href={`/races/${r.id}`}>
                      수정
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  조건에 맞는 대회가 없어요
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="muted">{data ? `${number(data.total)}개` : ''}</span>
        <span className="spacer" />
        <button className="btn small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          이전
        </button>
        <span className="muted">
          {page} / {pages}
        </span>
        <button
          className="btn small"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          다음
        </button>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RaceList />
    </Suspense>
  );
}
