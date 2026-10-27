'use client';

import { AdminNotice, AdminRacePage, NoticeAudience, type AdminRole } from '@berun/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { api, ApiError, qs } from '@/lib/api';
import { formatDate, number, shortDateTime } from '@/lib/format';
import { errorMessage, fieldLabel, fieldMessage } from '@/lib/messages';
import {
  emptyNoticeForm,
  formToInput,
  noticePreview,
  noticeToForm,
  validateNoticeForm,
  type NoticeForm as Form,
} from './notice-form-model';
import { ErrorAlert, Modal, Toast } from './ui';
import { adminAnalytics } from '@/lib/analytics';

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      <div>
        {children}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

/** 대회 검색해 고르기 (이동 = 대회) — 게시된 대회만 */
function RacePicker({ onPick }: { onPick: (id: string, name: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: string; name: string; raceDate: string }[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      api('GET', `/races${qs({ q: term, publishStatus: ['published'], pageSize: 10 })}`, {
        schema: AdminRacePage,
      })
        .then((p) => setItems(p.items))
        .catch(() => setItems([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input
        className="input"
        placeholder="대회명으로 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="대회 검색"
      />
      {items.length > 0 && (
        <ul className="picker">
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => onPick(r.id, r.name)}
              >
                {r.name} · {formatDate(r.raceDate)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TestRes = z.object({ notificationId: z.string() });

/**
 * A-008 공지·푸시 작성·수정 (PRD 8.6). [저장] = 작성 중(draft). [발송] = 저장 → 대상 수·미리보기 확인 →
 * owner는 바로 승인(즉시/예약), operator는 owner 승인 대기. 발송된 공지는 읽기 전용(내리기만).
 */
export function NoticeFormView({
  notice,
  role,
  onSaved,
}: {
  notice: AdminNotice | null;
  role: AdminRole;
  onSaved: (n: AdminNotice) => void;
}) {
  const [form, setForm] = useState<Form>(notice ? noticeToForm(notice) : emptyNoticeForm());
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ notice: AdminNotice; audience: NoticeAudience } | null>(
    null,
  );
  const [testUserId, setTestUserId] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [audience, setAudience] = useState<NoticeAudience | null>(null);

  const readOnly = !!notice && (notice.status === 'sent' || notice.status === 'withdrawn');
  const canWrite = role !== 'viewer' && !readOnly;
  const errors = { ...(touched ? validateNoticeForm(form) : {}), ...serverErrors };
  const preview = noticePreview(form);
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setServerErrors({});
  };

  useEffect(() => {
    if (!notice || readOnly) return;
    api('GET', `/notices/${notice.id}/audience`, { schema: NoticeAudience })
      .then(setAudience)
      .catch(() => setAudience(null));
  }, [notice, readOnly, form.kind]);

  const save = async (): Promise<AdminNotice | null> => {
    setTouched(true);
    setError(null);
    if (Object.keys(validateNoticeForm(form)).length) return null;
    setBusy(true);
    try {
      const body = formToInput(form);
      const saved = notice
        ? await api('PUT', `/notices/${notice.id}`, { body, schema: AdminNotice })
        : await api('POST', '/notices', { body, schema: AdminNotice });
      onSaved(saved);
      adminAnalytics.track('admin_notice_saved', {
        notice_id: saved.id,
        kind: saved.kind,
        send_push: saved.sendPush,
        scheduled: saved.scheduledAt !== null,
        is_edit: !!notice,
      });
      return saved;
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        setServerErrors(
          Object.fromEntries(
            err.fieldErrors.map((f) => [
              f.path === 'link.raceId' ? 'link' : f.path,
              fieldMessage(f.code),
            ]),
          ),
        );
        setError(
          `${errorMessage(err)} (${err.fieldErrors.map((f) => fieldLabel(f.path)).join(', ')})`,
        );
      } else setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startSend = async () => {
    const saved = await save();
    if (!saved) return;
    try {
      const a = await api('GET', `/notices/${saved.id}/audience`, { schema: NoticeAudience });
      setConfirm({ notice: saved, audience: a });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const approve = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const n = await api('POST', `/notices/${confirm.notice.id}/approve`, { schema: AdminNotice });
      adminAnalytics.track('admin_notice_approved', {
        notice_id: n.id,
        kind: n.kind,
        recipients: confirm.audience.recipients,
        scheduled: n.scheduledAt !== null,
      });
      setConfirm(null);
      onSaved(n);
      setToast(n.scheduledAt ? `${shortDateTime(n.scheduledAt)}에 보내요` : '곧 보내요 (1분 안)');
    } catch (err) {
      setConfirm(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!notice) return;
    try {
      await api('POST', `/notices/${notice.id}/test`, {
        body: { userId: testUserId.trim() },
        schema: TestRes,
      });
      adminAnalytics.track('admin_notice_test_sent', { notice_id: notice.id });
      setToast('테스트 알림을 보냈어요 (1분 안 도착)');
    } catch (err) {
      setError(
        err instanceof ApiError && err.fieldErrors?.some((f) => f.path === 'userId')
          ? '사용자 ID를 찾을 수 없어요'
          : errorMessage(err),
      );
    }
  };

  return (
    <>
      <ErrorAlert message={error} />
      <div className="card">
        <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0 }}>
          <Field label="종류">
            <div className="row">
              {(['notice', 'marketing'] as const).map((k) => (
                <label key={k} className="check">
                  <input
                    type="radio"
                    name="kind"
                    checked={form.kind === k}
                    onChange={() => set({ kind: k })}
                  />
                  {k === 'notice' ? '공지' : '마케팅'}
                </label>
              ))}
            </div>
          </Field>
          <Field label="제목 (1~30자)" error={errors.title}>
            <div className="row">
              {form.kind === 'marketing' && <span className="badge warn">(광고)</span>}
              <input
                className="input"
                aria-label="제목"
                value={form.title}
                maxLength={40}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            {form.kind === 'marketing' && (
              <div className="muted">
                마케팅은 &quot;(광고) &quot;가 자동으로 붙고 지울 수 없어요
              </div>
            )}
          </Field>
          <Field label="본문 (1~500자)" error={errors.body}>
            <textarea
              className="input"
              aria-label="본문"
              rows={6}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
            />
            <div className="muted">{[...form.body.trim()].length}/500 · 푸시 본문은 앞 60자</div>
          </Field>
          <Field label="대상">
            <span>
              {form.kind === 'notice' ? '공지: 전체 사용자' : '마케팅: 마케팅 동의자 전체'}
              {audience ? ` (대상 ${number(audience.recipients)}명)` : ''}
            </span>
          </Field>
          <Field label="채널">
            <div className="row">
              <label className="check">
                <input type="checkbox" checked disabled /> 앱 내 공지
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label="푸시 보내기"
                  checked={form.sendPush}
                  onChange={(e) => set({ sendPush: e.target.checked })}
                />
                푸시 보내기
              </label>
            </div>
          </Field>
          <Field label="이동" error={errors.link}>
            <div className="row">
              {(
                [
                  ['notice', '공지 상세'],
                  ['race', '대회'],
                  ['race_list', '대회 목록'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="check">
                  <input
                    type="radio"
                    name="link"
                    checked={form.linkType === v}
                    onChange={() => set({ linkType: v })}
                  />
                  {label}
                </label>
              ))}
            </div>
            {form.linkType === 'race' && (
              <div style={{ marginTop: 8 }}>
                {form.linkRaceId && <div>선택: {form.linkRaceName || form.linkRaceId}</div>}
                <RacePicker onPick={(id, name) => set({ linkRaceId: id, linkRaceName: name })} />
              </div>
            )}
          </Field>
          <Field label="발송 시각" error={errors.scheduledAt}>
            <div className="row">
              <label className="check">
                <input
                  type="radio"
                  name="timing"
                  checked={form.timing === 'now'}
                  onChange={() => set({ timing: 'now' })}
                />
                즉시
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="timing"
                  checked={form.timing === 'scheduled'}
                  onChange={() => set({ timing: 'scheduled' })}
                />
                예약
              </label>
              {form.timing === 'scheduled' && (
                <>
                  <input
                    className="input"
                    type="date"
                    aria-label="예약 날짜"
                    value={form.date}
                    onChange={(e) => set({ date: e.target.value })}
                  />
                  <input
                    className="input"
                    type="time"
                    aria-label="예약 시각"
                    value={form.time}
                    onChange={(e) => set({ time: e.target.value })}
                  />
                </>
              )}
            </div>
            {form.kind === 'marketing' && (
              <div className="muted">마케팅은 08:00~20:59에만 보낼 수 있어요</div>
            )}
          </Field>
        </fieldset>
        <Field label="미리보기">
          <div className="preview" data-testid="notice-preview">
            <strong>{preview.title || '(제목)'}</strong>
            <div>{preview.body || '(본문)'}</div>
          </div>
        </Field>
        {notice && canWrite && (
          <Field label="테스트 발송 (사용자 ID)">
            <div className="row">
              <input
                className="input"
                aria-label="테스트 사용자 ID"
                placeholder="관리자 본인의 테스트 계정 사용자 ID"
                value={testUserId}
                onChange={(e) => setTestUserId(e.target.value)}
              />
              <button
                type="button"
                className="btn small"
                disabled={!testUserId.trim()}
                onClick={() => void sendTest()}
              >
                테스트 발송
              </button>
            </div>
          </Field>
        )}
        {canWrite && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void save().then((n) => n && setToast('저장했어요 (작성 중 — 아직 보내지 않아요)'))
              }
            >
              저장
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() =>
                role === 'owner'
                  ? void startSend()
                  : void save().then((n) => n && setToast('저장했어요. owner가 승인하면 발송돼요'))
              }
            >
              {role === 'owner' ? '발송' : '승인 요청'}
            </button>
          </div>
        )}
        {readOnly && (
          <p className="muted">
            발송된 공지는 수정할 수 없어요. 목록에서 [앱 내 공지 내리기]만 할 수 있어요.
          </p>
        )}
      </div>
      {confirm && (
        <Modal
          title="발송 확인"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void approve()}
              >
                발송
              </button>
            </>
          }
        >
          <p>
            <strong>{number(confirm.audience.recipients)}명</strong>에게{' '}
            {confirm.notice.scheduledAt ? `${shortDateTime(confirm.notice.scheduledAt)}에` : '지금'}{' '}
            보낼까요?
            {confirm.notice.sendPush
              ? ` (푸시 가능 ${number(confirm.audience.pushable)}명)`
              : ' (앱 내 공지만)'}
          </p>
          <div className="preview">
            <strong>{confirm.notice.displayTitle}</strong>
            <div>{noticePreview(confirm.notice).body}</div>
          </div>
        </Modal>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
