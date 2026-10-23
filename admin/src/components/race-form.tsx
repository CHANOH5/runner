'use client';

import {
  AdminRace,
  AdminRaceSaveRes,
  DedupeWarning,
  Impact,
  REGION_CODES,
  type AdminRole,
  type DistanceCategory,
  type FieldError,
  type PublishMissing,
} from '@berun/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { api, ApiError, qs } from '@/lib/api';
import {
  CATEGORY_LABELS,
  METHOD_LABELS,
  parseLatLng,
  parseQuickDate,
  parseQuickTime,
  PUBLISH_LABELS,
  RACE_TYPE_LABELS,
  REGION_LABELS,
  STATUS_LABELS,
  shortDate,
  suggestCategory,
  TIME_LIMIT_HINT,
  weekday,
  number,
} from '@/lib/format';
import { errorMessage, fieldLabel, fieldMessage, PUBLISH_MISSING_LABELS } from '@/lib/messages';
import {
  buildInput,
  emptyForm,
  fromRace,
  PRESET_COMBOS,
  PRESETS,
  presetRow,
  scheduleChanged,
  type EventRow,
  type FormState,
} from './race-form-model';
import { Modal, Toast } from './ui';

const DRAFT_KEY = 'berun-admin:new-race-draft';
const AUTOSAVE_MS = 30_000;
const CreateRes = z.object({ race: AdminRace, dedupeWarnings: z.array(DedupeWarning) });

type Props = {
  /** 수정이면 저장된 대회, 새 대회면 null */
  race: AdminRace | null;
  role: AdminRole;
  /** 복제 직후: 원본 이름과 노란 강조 칸 (PRD 8.4.4) */
  clonedFrom?: string | null;
  shifted?: string[];
  /** 저장하고 새 대회 시 유지할 값 */
  keep?: Partial<Pick<FormState, 'regionCode' | 'raceType'>>;
  onSaved: (race: AdminRace) => void;
  onSavedAndNew: (keep: Partial<Pick<FormState, 'regionCode' | 'raceType'>>) => void;
  onClone?: () => void;
  onDeleted?: () => void;
};

type Pending = {
  kind: 'impact';
  impact: z.infer<typeof Impact>;
  reason: 'cancel' | 'postpone' | 'schedule';
  then: () => void;
};

function Field({
  label,
  req,
  error,
  children,
  hint,
}: {
  label: string;
  req?: 'save' | 'publish' | 'auto';
  error?: string | undefined;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="field">
      <div className="label">
        {label}
        {req && (
          <span className={`req ${req}`}>
            {req === 'save' ? '저장' : req === 'publish' ? '게시' : '자동'}
          </span>
        )}
      </div>
      <div>
        {children}
        {hint && (
          <div className="hint" style={{ marginTop: 4 }}>
            {hint}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

export function RaceForm({
  race,
  role,
  clonedFrom,
  shifted = [],
  keep,
  onSaved,
  onSavedAndNew,
  onClone,
  onDeleted,
}: Props) {
  const [form, setForm] = useState<FormState>(() => (race ? fromRace(race) : emptyForm(keep)));
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<PublishMissing[]>([]);
  const [dupes, setDupes] = useState<z.infer<typeof DedupeWarning>[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notifyChange, setNotifyChange] = useState(true);
  const [hideMemo, setHideMemo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restore, setRestore] = useState<FormState | null>(null);
  const [common, setCommon] = useState({ startTime: '', timeLimitMin: '', feeKrw: '' });
  const formRef = useRef<HTMLFormElement>(null);

  // 저장 후 서버 값(새 종목 id, updatedAt 등)으로 폼을 다시 맞춘다. 화면을 다시 마운트하지 않아 에러 표시가 남는다
  const syncedAt = useRef(race?.updatedAt);
  useEffect(() => {
    if (race && race.updatedAt !== syncedAt.current) {
      syncedAt.current = race.updatedAt;
      setForm(fromRace(race));
    }
  }, [race]);

  const isNew = race === null;
  const published = race?.publishStatus === 'published';
  const shiftedSet = useMemo(() => new Set(shifted), [shifted]);
  const errOf = (path: string) => {
    const e = fieldErrors.find((x) => x.path === path);
    return e ? fieldMessage(e.code) : undefined;
  };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ---- 작성 중 보호: 새 대회 폼은 30초마다 브라우저에 임시 저장 (PRD 8.4.1) ----
  useEffect(() => {
    if (!isNew) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setRestore(JSON.parse(raw) as FormState);
    } catch {
      /* 저장소를 쓸 수 없으면 건너뜀 */
    }
  }, [isNew]);
  const formRefState = useRef(form);
  formRefState.current = form;
  useEffect(() => {
    if (!isNew) return;
    const t = setInterval(() => {
      try {
        const f = formRefState.current;
        if (f.name || f.raceDate || f.events.length)
          localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
      } catch {
        /* 무시 */
      }
    }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [isNew]);
  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 무시 */
    }
  };

  // ---- 입력 중 중복 경고 (대회명 + 대회일) ----
  const parsedDate = parseQuickDate(form.raceDate);
  useEffect(() => {
    const name = form.name.trim();
    if (!name || !parsedDate) {
      setDupes([]);
      return;
    }
    const t = setTimeout(() => {
      api('GET', `/races/duplicates${qs({ name, raceDate: parsedDate })}`, {
        schema: z.array(DedupeWarning),
      })
        .then((rows) => setDupes(rows.filter((r) => r.id !== race?.id)))
        .catch(() => setDupes([]));
    }, 400);
    return () => clearTimeout(t);
  }, [form.name, parsedDate, race?.id]);

  // ---- 저장 ----
  const applyError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'PUBLISH_REQUIREMENTS_UNMET') {
        setMissing((err.details?.missing as PublishMissing[] | undefined) ?? []);
        setError(errorMessage(err));
        return;
      }
      if (err.fieldErrors?.length) setFieldErrors(err.fieldErrors);
    }
    setError(errorMessage(err));
  }, []);

  /** 저장만 (새 대회면 초안 생성). 성공하면 저장된 대회 */
  const persist = useCallback(
    async (opts: { notify: boolean }): Promise<AdminRace | null> => {
      setError(null);
      setMissing([]);
      const built = buildInput(form, { notifyChange: opts.notify });
      if (!built.ok) {
        setFieldErrors(built.fieldErrors);
        setError('입력값을 확인해주세요.');
        return null;
      }
      setFieldErrors([]);
      setBusy(true);
      try {
        if (isNew) {
          const res = await api('POST', '/races', { body: built.input, schema: CreateRes });
          clearDraft();
          setDupes(res.dedupeWarnings);
          return res.race;
        }
        const res = await api('PUT', `/races/${race.id}`, {
          body: built.input,
          headers: { 'if-match': race.updatedAt },
          schema: AdminRaceSaveRes,
        });
        setDupes(res.dedupeWarnings);
        const fx = res.sideEffects;
        setToast(
          fx.sentChangeNotice
            ? `저장했어요 · 변경 알림을 ${number(fx.affectedUsers)}명에게 보내요`
            : fx.notificationsRescheduled
              ? '저장했어요 · 알림 예약을 다시 계산해요'
              : '저장했어요',
        );
        return res.race;
      } catch (err) {
        applyError(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [form, isNew, race, applyError],
  );

  /** 게시 대회의 취소·연기·일정 변경이면 영향 확인 모달을 먼저 띄운다 */
  const save = useCallback(
    async (after?: (r: AdminRace) => void) => {
      const built = buildInput(form);
      if (race && published && built.ok) {
        const reason =
          race.status !== 'cancelled' && built.input.status === 'cancelled'
            ? 'cancel'
            : race.status !== 'postponed' && built.input.status === 'postponed'
              ? 'postpone'
              : scheduleChanged(race, built.input)
                ? 'schedule'
                : null;
        if (reason) {
          try {
            const impact = await api('GET', `/races/${race.id}/impact`, { schema: Impact });
            setNotifyChange(true);
            setPending({
              kind: 'impact',
              impact,
              reason,
              then: () => void persist({ notify: true }).then((r) => r && (after ?? onSaved)(r)),
            });
          } catch (err) {
            applyError(err);
          }
          return;
        }
      }
      const saved = await persist({ notify: true });
      if (saved) {
        if (isNew) setToast('초안을 저장했어요');
        (after ?? onSaved)(saved);
      }
    },
    [form, race, published, persist, isNew, onSaved, applyError],
  );

  const publish = async () => {
    // 바뀐 내용이 있으면(또는 새 대회면) 먼저 저장하고 게시한다
    const saved = await persist({ notify: true });
    if (!saved) return;
    setBusy(true);
    try {
      const res = await api('POST', `/races/${saved.id}/publish`, { schema: AdminRace });
      setToast('게시했어요 · 앱에 보이고 알림 예약이 만들어져요');
      onSaved(res);
    } catch (err) {
      applyError(err);
      onSaved(saved);
    } finally {
      setBusy(false);
    }
  };

  const simple = async (path: string, body: unknown, done: string) => {
    if (!race) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api('POST', `/races/${race.id}/${path}`, { body, schema: AdminRace });
      setToast(done);
      onSaved(res);
    } catch (err) {
      applyError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!race) return;
    setConfirmDelete(false);
    try {
      await api('DELETE', `/races/${race.id}`);
      onDeleted?.();
    } catch (err) {
      applyError(err);
    }
  };

  // ---- 키보드: ⌘/Ctrl+S 저장, ⌘/Ctrl+Enter 저장하고 새 대회 (PRD 8.4.1) ----
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const keepNext = {
          regionCode: formRefState.current.regionCode,
          raceType: formRefState.current.raceType,
        };
        void saveRef.current(() => onSavedAndNew(keepNext));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSavedAndNew]);

  // ---- 종목 표 ----
  const setRow = (key: string, patch: Partial<EventRow>) =>
    set(
      'events',
      form.events.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  const addPresets = (names: string[]) => set('events', [...form.events, ...names.map(presetRow)]);
  const applyCommon = () =>
    set(
      'events',
      form.events.map((r) => ({
        ...r,
        ...(common.startTime && {
          startTime: parseQuickTime(common.startTime) ?? common.startTime,
        }),
        ...(common.timeLimitMin && { timeLimitMin: common.timeLimitMin }),
        ...(common.feeKrw && { feeKrw: common.feeKrw }),
      })),
    );
  /** Enter: 같은 열의 다음 행으로 이동 */
  const gridKey = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: string) => {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const next = formRef.current?.querySelector<HTMLInputElement>(
      `[data-row="${row + 1}"][data-col="${col}"]`,
    );
    next?.focus();
  };

  const cls = (path: string) =>
    [errOf(path) ? 'invalid' : '', shiftedSet.has(path) ? 'shifted' : ''].join(' ').trim();
  const errorItems = fieldErrors.map((e) => `${fieldLabel(e.path)}: ${fieldMessage(e.code)}`);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="page-head">
        <div>
          <h1>{isNew ? '새 대회' : clonedFrom ? '새 대회 (복제)' : '대회 수정'}</h1>
          {race && (
            <div className="row" style={{ marginTop: 6 }}>
              <span
                className={`badge ${published ? 'ok' : race.publishStatus === 'hidden' ? 'danger' : ''}`}
              >
                {PUBLISH_LABELS[race.publishStatus]}
              </span>
              <span className="muted">
                관심 {number(race.interestCount)} · 참가 예정 {number(race.registrationCount)} ·
                수정 {shortDate(race.updatedAt)}
              </span>
            </div>
          )}
        </div>
        {race && (
          <div className="actions">
            <button type="button" className="btn" onClick={onClone} disabled={busy}>
              복제
            </button>
            {published && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void simple('unpublish', undefined, '초안으로 되돌렸어요')}
              >
                게시 취소
              </button>
            )}
            {race.publishStatus !== 'hidden' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setHideMemo('주최 측 요청')}
              >
                숨김
              </button>
            )}
            {role === 'owner' && (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </button>
            )}
          </div>
        )}
      </div>

      {clonedFrom && (
        <div className="alert warn">
          {clonedFrom}을(를) 복제했어요. 노란(강조) 날짜 칸을 확인하고, 게시 전에 [확인 완료 —
          오늘로 갱신]을 체크하세요.
        </div>
      )}
      {restore && (
        <div className="alert info row">
          작성 중이던 내용을 불러올까요?
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setForm(restore);
              setRestore(null);
            }}
          >
            불러오기
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              clearDraft();
              setRestore(null);
            }}
          >
            버리기
          </button>
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
          {missing.length > 0 && (
            <ul>
              {missing.map((m) => (
                <li key={m}>{PUBLISH_MISSING_LABELS[m]}</li>
              ))}
            </ul>
          )}
          {missing.length === 0 && errorItems.length > 0 && (
            <ul>
              {errorItems.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {race &&
        race.publishStatus !== 'published' &&
        race.publishMissing.length > 0 &&
        missing.length === 0 && (
          <div className="alert info">
            게시 전에 채울 항목:{' '}
            {race.publishMissing.map((m) => PUBLISH_MISSING_LABELS[m]).join(' · ')}
          </div>
        )}

      <div className="card">
        <Field label="대회명" req="save" error={errOf('name')}>
          <input
            aria-label="대회명"
            className={cls('name')}
            style={{ width: '100%' }}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus={isNew}
          />
          {dupes.length > 0 && (
            <div className="alert warn" style={{ marginTop: 8, marginBottom: 0 }}>
              비슷한 대회가 있어요:{' '}
              {dupes.map((d) => (
                <span key={d.id} style={{ marginRight: 10 }}>
                  {d.name} ({d.raceDate}){' '}
                  <Link href={`/races/${d.id}`} target="_blank">
                    열기
                  </Link>
                </span>
              ))}
            </div>
          )}
        </Field>
        <Field
          label="대회일"
          req="save"
          error={errOf('raceDate')}
          hint="입력: 2027-03-15 · 20270315 · 0315 (가까운 미래)"
        >
          <div className="row">
            <input
              aria-label="대회일"
              className={cls('raceDate')}
              value={form.raceDate}
              onChange={(e) => set('raceDate', e.target.value)}
              onBlur={() => parsedDate && set('raceDate', parsedDate)}
              placeholder="2027-03-15"
              style={{ width: 160 }}
            />
            {parsedDate && (
              <span className="muted">
                {parsedDate} ({weekday(parsedDate)})
              </span>
            )}
          </div>
        </Field>
        <Field label="지역" req="save" error={errOf('regionCode')}>
          <select
            aria-label="지역"
            className={cls('regionCode')}
            value={form.regionCode}
            onChange={(e) => set('regionCode', e.target.value as FormState['regionCode'])}
          >
            <option value="">선택</option>
            {REGION_CODES.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="주최 / 장소명">
          <div className="row">
            <input
              aria-label="주최"
              placeholder="주최"
              value={form.organizer}
              onChange={(e) => set('organizer', e.target.value)}
              style={{ width: 240 }}
            />
            <input
              aria-label="장소명"
              placeholder="장소명"
              value={form.venueName}
              onChange={(e) => set('venueName', e.target.value)}
              style={{ width: 240 }}
            />
          </div>
        </Field>
        <Field
          label="장소 주소 · 좌표"
          error={errOf('venuePoint') ?? errOf('venuePoint.lat') ?? errOf('venuePoint.lng')}
          hint="좌표는 '37.5665, 126.9780' 형식으로 붙여넣기 (국내 범위). 주소 검색·지도 핀은 지오코딩 확정(D-008) 후"
        >
          <div className="row">
            <input
              aria-label="장소 주소"
              placeholder="주소"
              value={form.venueAddress}
              onChange={(e) => set('venueAddress', e.target.value)}
              style={{ width: 360 }}
            />
            <input
              aria-label="좌표"
              placeholder="위도, 경도"
              className={cls('venuePoint')}
              value={form.venuePoint}
              onChange={(e) => set('venuePoint', e.target.value)}
              style={{ width: 200 }}
            />
            {form.venuePoint && parseLatLng(form.venuePoint) && (
              <span className="badge ok">좌표 있음</span>
            )}
          </div>
        </Field>
        <Field
          label="접수 기간"
          error={errOf('registrationOpensAt') ?? errOf('registrationClosesAt')}
          hint="시각: 1000 → 10:00, 9 → 09:00. 마감 시각을 비우면 23:59"
        >
          <div className="row">
            <input
              aria-label="접수 오픈일"
              className={cls('registrationOpensAt')}
              placeholder="오픈일"
              value={form.opensDate}
              onChange={(e) => set('opensDate', e.target.value)}
              onBlur={() => {
                const d = parseQuickDate(form.opensDate);
                if (d) set('opensDate', d);
              }}
              style={{ width: 130 }}
            />
            <input
              aria-label="접수 오픈 시각"
              placeholder="10:00"
              value={form.opensTime}
              disabled={form.opensTimeUnknown}
              onChange={(e) => set('opensTime', e.target.value)}
              onBlur={() => {
                const t = parseQuickTime(form.opensTime);
                if (t) set('opensTime', t);
              }}
              style={{ width: 80 }}
            />
            <span className="muted">~</span>
            <input
              aria-label="접수 마감일"
              className={cls('registrationClosesAt')}
              placeholder="마감일"
              value={form.closesDate}
              onChange={(e) => set('closesDate', e.target.value)}
              onBlur={() => {
                const d = parseQuickDate(form.closesDate);
                if (d) set('closesDate', d);
              }}
              style={{ width: 130 }}
            />
            <input
              aria-label="접수 마감 시각"
              placeholder="23:59"
              value={form.closesTime}
              onChange={(e) => set('closesTime', e.target.value)}
              onBlur={() => {
                const t = parseQuickTime(form.closesTime);
                if (t) set('closesTime', t);
              }}
              style={{ width: 80 }}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={form.opensTimeUnknown}
                onChange={(e) => set('opensTimeUnknown', e.target.checked)}
              />
              오픈 시각 미정
            </label>
          </div>
        </Field>
        <Field
          label="공식 홈페이지 URL"
          req="publish"
          error={errOf('officialUrl')}
          hint="입력하면 공식 출처(대표 출처, 확인 일시 = 지금)가 자동 생성돼요"
        >
          <input
            aria-label="공식 홈페이지 URL"
            className={cls('officialUrl')}
            placeholder="https://"
            value={form.officialUrl}
            onChange={(e) => set('officialUrl', e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field
          label="접수 URL · 코스 안내 URL"
          error={errOf('registrationUrl') ?? errOf('courseUrl')}
        >
          <div className="row">
            <input
              aria-label="접수 URL"
              className={cls('registrationUrl')}
              placeholder="https:// (접수)"
              value={form.registrationUrl}
              onChange={(e) => set('registrationUrl', e.target.value)}
              style={{ width: 360 }}
            />
            <input
              aria-label="코스 안내 URL"
              className={cls('courseUrl')}
              placeholder="https:// (코스)"
              value={form.courseUrl}
              onChange={(e) => set('courseUrl', e.target.value)}
              style={{ width: 360 }}
            />
          </div>
        </Field>
        <Field
          label="대회 종류 · 접수 방식 · 상태"
          req="auto"
          error={errOf('raceType') ?? errOf('status')}
          hint={
            published
              ? '게시 중인 대회는 종류를 바꿀 수 없어요. 먼저 숨김 또는 게시 취소를 해주세요'
              : 'Phase 1은 도로 대회만 게시할 수 있어요'
          }
        >
          <div className="row">
            <select
              aria-label="대회 종류"
              value={form.raceType}
              disabled={published}
              onChange={(e) => set('raceType', e.target.value as FormState['raceType'])}
            >
              {Object.entries(RACE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              aria-label="접수 방식"
              value={form.registrationMethod}
              onChange={(e) =>
                set('registrationMethod', e.target.value as FormState['registrationMethod'])
              }
            >
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              aria-label="상태"
              value={form.status}
              onChange={(e) => set('status', e.target.value as FormState['status'])}
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="최종 확인일" req="publish">
          <label className="check">
            <input
              type="checkbox"
              aria-label="확인 완료 — 오늘로 갱신"
              checked={form.markVerifiedNow}
              onChange={(e) => set('markVerifiedNow', e.target.checked)}
            />
            확인 완료 — 오늘로 갱신
          </label>
          <div className="hint" style={{ marginTop: 4 }}>
            {isNew
              ? '새 대회는 저장할 때 오늘로 기록돼요'
              : race.lastVerifiedAt
                ? `현재: ${shortDate(race.lastVerifiedAt)}`
                : '복제 초안: 비어 있음 — 게시 전 체크 필수'}
          </div>
        </Field>

        <Field label="종목" req="publish" error={errOf('events')}>
          <div className="row" style={{ marginBottom: 8 }}>
            {Object.keys(PRESETS).map((p) => (
              <button key={p} type="button" className="btn small" onClick={() => addPresets([p])}>
                + {p}
              </button>
            ))}
            {Object.entries(PRESET_COMBOS).map(([label, names]) => (
              <button
                key={label}
                type="button"
                className="btn small"
                onClick={() => addPresets(names)}
              >
                + {label}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="muted">공통값 적용</span>
            <input
              aria-label="공통 출발 시각"
              placeholder="출발 08:00"
              value={common.startTime}
              onChange={(e) => setCommon({ ...common, startTime: e.target.value })}
              style={{ width: 110 }}
            />
            <input
              aria-label="공통 제한 시간"
              placeholder="제한(분)"
              value={common.timeLimitMin}
              onChange={(e) => setCommon({ ...common, timeLimitMin: e.target.value })}
              style={{ width: 90 }}
            />
            <input
              aria-label="공통 참가비"
              placeholder="참가비(원)"
              value={common.feeKrw}
              onChange={(e) => setCommon({ ...common, feeKrw: e.target.value })}
              style={{ width: 110 }}
            />
            <button
              type="button"
              className="btn small"
              onClick={applyCommon}
              disabled={!form.events.length}
            >
              모든 종목에 적용
            </button>
          </div>
          {form.events.length === 0 ? (
            <div className="muted">종목 0개 — 프리셋 버튼으로 추가</div>
          ) : (
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>종목명</th>
                    <th>분류</th>
                    <th>거리(m)</th>
                    <th>출발</th>
                    <th>제한(분)</th>
                    <th>참가비</th>
                    <th>정원</th>
                    <th title="종목별 접수 기간 (고급)">기간</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.events.map((r, i) => (
                    <EventRows
                      key={r.key}
                      row={r}
                      index={i}
                      errOf={errOf}
                      shifted={shiftedSet}
                      onChange={(patch) => setRow(r.key, patch)}
                      onRemove={() =>
                        set(
                          'events',
                          form.events.filter((x) => x.key !== r.key),
                        )
                      }
                      onGridKey={gridKey}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hint" style={{ marginTop: 6 }}>
            Tab으로 다음 칸, Enter로 아래 행. 제한 시간의 회색 참고값은 저장되지 않아요.
          </div>
        </Field>

        <div className="sticky-actions">
          <span className="hint">
            {isNew && '자동 임시 저장 30초 · '}
            <kbd>⌘S</kbd> 저장 · <kbd>⌘Enter</kbd> 저장하고 새 대회
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void save(() =>
                onSavedAndNew({ regionCode: form.regionCode, raceType: form.raceType }),
              )
            }
          >
            저장하고 새 대회
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {published ? '저장' : '저장 (초안)'}
          </button>
          {!published && (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              게시
            </button>
          )}
        </div>
      </div>

      {pending && race && (
        <Modal
          title="저장하면 사용자에게 영향이 있어요"
          onClose={() => setPending(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPending(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const go = pending.then;
                  setPending(null);
                  if (pending.reason === 'schedule' && !notifyChange) {
                    void persist({ notify: false }).then((r) => r && onSaved(r));
                  } else go();
                }}
              >
                저장
              </button>
            </>
          }
        >
          <p>
            관심 <b>{number(pending.impact.interestCount)}</b>명, 참가 예정{' '}
            <b>{number(pending.impact.registrationCount)}</b>명에게 영향이 있어요.
          </p>
          {pending.reason === 'cancel' && (
            <p className="muted">취소 알림(N-06a)이 자동으로 발송돼요. 끌 수 없어요.</p>
          )}
          {pending.reason === 'postpone' && (
            <p className="muted">연기 알림(N-06b)이 자동으로 발송돼요.</p>
          )}
          {pending.reason === 'schedule' && (
            <>
              <p className="muted">알림 예약은 자동으로 다시 계산돼요.</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={notifyChange}
                  onChange={(e) => setNotifyChange(e.target.checked)}
                />
                변경 알림 보내기 (N-06c &quot;{race.name} 일정이 바뀌었어요&quot;)
              </label>
            </>
          )}
        </Modal>
      )}
      {hideMemo !== null && (
        <Modal
          title="대회 숨김"
          onClose={() => setHideMemo(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setHideMemo(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!hideMemo.trim()}
                onClick={() => {
                  const memo = hideMemo;
                  setHideMemo(null);
                  void simple(
                    'hide',
                    { memo },
                    '숨겼어요 · 앱에서 "더 이상 볼 수 없는 대회"로 보여요',
                  );
                }}
              >
                숨기기
              </button>
            </>
          }
        >
          <p className="muted">
            관심·참가 예정자에게는 &quot;더 이상 볼 수 없는 대회예요&quot;로 보여요. 메모는 감사
            로그에 남아요.
          </p>
          <input
            aria-label="숨김 메모"
            value={hideMemo}
            onChange={(e) => setHideMemo(e.target.value)}
            style={{ width: '100%' }}
          />
        </Modal>
      )}
      {confirmDelete && race && (
        <Modal
          title="대회 삭제"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                취소
              </button>
              <button type="button" className="btn danger" onClick={() => void remove()}>
                삭제
              </button>
            </>
          }
        >
          <p>
            {race.name}을(를) 삭제할까요? 되돌릴 수 없어요. 관심·참가 예정자가 있으면 삭제할 수 없고
            &quot;취소&quot; 상태로 바꿔야 해요.
          </p>
        </Modal>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </form>
  );
}

function EventRows({
  row,
  index,
  errOf,
  shifted,
  onChange,
  onRemove,
  onGridKey,
}: {
  row: EventRow;
  index: number;
  errOf: (p: string) => string | undefined;
  shifted: Set<string>;
  onChange: (patch: Partial<EventRow>) => void;
  onRemove: () => void;
  onGridKey: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: string) => void;
}) {
  const p = `events[${index}]`;
  const cell = (
    col: keyof EventRow,
    label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <input
      aria-label={`${label} ${index + 1}`}
      data-row={index}
      data-col={col}
      className={[
        errOf(`${p}.${col}`) ? 'invalid' : '',
        shifted.has(`${p}.${col}`) ? 'shifted' : '',
      ]
        .join(' ')
        .trim()}
      title={errOf(`${p}.${col}`)}
      value={String(row[col] ?? '')}
      onChange={(e) => onChange({ [col]: e.target.value })}
      onKeyDown={(e) => onGridKey(e, index, col)}
      {...extra}
    />
  );
  return (
    <>
      <tr>
        <td>{cell('name', '종목명')}</td>
        <td style={{ width: 90 }}>
          <select
            aria-label={`분류 ${index + 1}`}
            value={row.category}
            onChange={(e) =>
              onChange({ category: e.target.value as DistanceCategory, categoryTouched: true })
            }
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </td>
        <td style={{ width: 100 }}>
          {cell('distanceM', '거리', {
            inputMode: 'numeric',
            onChange: (e) => {
              const v = e.target.value;
              const n = Number(v.replace(/,/g, ''));
              onChange({
                distanceM: v,
                ...(!row.categoryTouched && n > 0 && { category: suggestCategory(n) }),
              });
            },
          })}
        </td>
        <td style={{ width: 80 }}>
          {cell('startTime', '출발', {
            placeholder: '08:00',
            onBlur: () => {
              const t = parseQuickTime(row.startTime);
              if (t) onChange({ startTime: t });
            },
          })}
        </td>
        <td style={{ width: 80 }}>
          {cell('timeLimitMin', '제한 시간', {
            inputMode: 'numeric',
            placeholder: TIME_LIMIT_HINT[row.category]
              ? `${TIME_LIMIT_HINT[row.category]} (참고)`
              : '',
          })}
        </td>
        <td style={{ width: 100 }}>{cell('feeKrw', '참가비', { inputMode: 'numeric' })}</td>
        <td style={{ width: 80 }}>{cell('capacity', '정원', { inputMode: 'numeric' })}</td>
        <td style={{ width: 50 }}>
          <button
            type="button"
            className="btn small ghost"
            aria-label={`종목별 접수 기간 ${index + 1}`}
            aria-expanded={row.advanced}
            onClick={() => onChange({ advanced: !row.advanced })}
          >
            {row.advanced ? '▾' : '▸'}
          </button>
        </td>
        <td style={{ width: 40 }}>
          <button
            type="button"
            className="btn small ghost"
            aria-label={`종목 삭제 ${index + 1}`}
            title={
              row.registrationCount
                ? `참가 예정 ${row.registrationCount}명 — 삭제할 수 없어요`
                : '삭제'
            }
            disabled={row.registrationCount > 0}
            onClick={onRemove}
          >
            ×
          </button>
        </td>
      </tr>
      {row.advanced && (
        <tr>
          <td colSpan={9}>
            <div className="row" style={{ padding: '2px 4px 8px' }}>
              <span className="hint">종목별 접수 기간 (대회 기간과 다를 때만)</span>
              {cell('regOpensDate', '종목 접수 오픈일', {
                placeholder: '오픈일',
                style: { width: 120 },
              })}
              {cell('regOpensTime', '종목 접수 오픈 시각', {
                placeholder: '10:00',
                style: { width: 80 },
              })}
              <span>~</span>
              {cell('regClosesDate', '종목 접수 마감일', {
                placeholder: '마감일',
                style: { width: 120 },
              })}
              {cell('regClosesTime', '종목 접수 마감 시각', {
                placeholder: '23:59',
                style: { width: 80 },
              })}
              {errOf(`${p}.registrationOpensAt`) && (
                <span className="error">{errOf(`${p}.registrationOpensAt`)}</span>
              )}
              {errOf(`${p}.registrationClosesAt`) && (
                <span className="error">{errOf(`${p}.registrationClosesAt`)}</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
