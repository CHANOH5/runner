import type { AdminNotice } from '@berun/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '@/test/fetch-mock';
import { NoticeFormView } from './notice-form';
import { noticePreview, validateNoticeForm, emptyNoticeForm } from './notice-form-model';

const ID = '0199f000-0000-7000-8000-00000000cc01';

const notice = (over: Partial<AdminNotice> = {}): AdminNotice => ({
  id: ID,
  kind: 'notice',
  title: '서비스 점검 안내',
  displayTitle: '서비스 점검 안내',
  body: '점검합니다',
  sendPush: true,
  link: { type: 'notice' },
  linkRaceName: null,
  scheduledAt: null,
  status: 'draft',
  createdBy: { id: '0199f000-0000-7000-8000-00000000dd01', email: 'owner@example.com' },
  approvedBy: null,
  approvedAt: null,
  publishedAt: null,
  createdAt: '2026-10-27T10:00:00+09:00',
  stats: { recipients: 0, pushed: 0, failed: 0, inAppOnly: 0, pending: 0, opened: 0 },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('A-008 폼 규칙 (PRD 8.6)', () => {
  it('마케팅 야간 예약은 막는다, 필수값', () => {
    const f = {
      ...emptyNoticeForm(),
      kind: 'marketing' as const,
      title: 'a',
      body: 'b',
      timing: 'scheduled' as const,
      date: '2026-11-01',
      time: '21:00',
    };
    expect(validateNoticeForm(f).scheduledAt).toBe('마케팅은 08:00~20:59에만 보낼 수 있어요');
    expect(validateNoticeForm({ ...f, time: '20:59' }).scheduledAt).toBeUndefined();
    expect(Object.keys(validateNoticeForm(emptyNoticeForm())).sort()).toEqual(['body', 'title']);
  });

  it('미리보기: 마케팅 "(광고) " 제목, 푸시 본문 60자 + 수신 거부 안내', () => {
    const p = noticePreview({ kind: 'marketing', title: '가을 이벤트', body: '가'.repeat(100) });
    expect(p.title).toBe('(광고) 가을 이벤트');
    expect([...p.body].length).toBe(60);
    expect(p.body.endsWith('수신 거부: 마이 > 설정 > 알림 설정')).toBe(true);
  });
});

describe('NoticeFormView', () => {
  it('owner: 저장 → 대상 수·미리보기 확인 → 승인(발송)', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'POST' && c.path === '/notices') return { status: 201, body: notice() };
      if (c.path === `/notices/${ID}/audience`)
        return { body: { recipients: 12034, pushable: 9000 } };
      if (c.path === `/notices/${ID}/approve`)
        return { body: notice({ status: 'approved', approvedAt: '2026-10-27T10:01:00+09:00' }) };
      return undefined;
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<NoticeFormView notice={null} role="owner" onSaved={onSaved} />);
    await user.type(screen.getByLabelText('제목'), '서비스 점검 안내');
    await user.type(screen.getByLabelText('본문'), '점검합니다');
    expect(screen.getByTestId('notice-preview')).toHaveTextContent('서비스 점검 안내');
    await user.click(screen.getByRole('button', { name: '발송' }));
    const dialog = await screen.findByRole('dialog', { name: '발송 확인' });
    expect(dialog).toHaveTextContent('12,034명');
    expect(dialog).toHaveTextContent('푸시 가능 9,000명');
    await user.click(within(dialog).getByRole('button', { name: '발송' }));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /notices',
      `GET /notices/${ID}/audience`,
      `POST /notices/${ID}/approve`,
    ]);
    expect(calls[0]!.body).toEqual({
      kind: 'notice',
      title: '서비스 점검 안내',
      body: '점검합니다',
      sendPush: true,
      link: { type: 'notice' },
      scheduledAt: null,
    });
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('operator는 [승인 요청] = 저장만, 승인 호출 없음', async () => {
    const calls = mockFetch((c) =>
      c.method === 'POST' && c.path === '/notices' ? { status: 201, body: notice() } : undefined,
    );
    const user = userEvent.setup();
    render(<NoticeFormView notice={null} role="operator" onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('제목'), '제목');
    await user.type(screen.getByLabelText('본문'), '본문');
    await user.click(screen.getByRole('button', { name: '승인 요청' }));
    expect(await screen.findByRole('status')).toHaveTextContent('owner가 승인하면 발송돼요');
    expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(false);
  });

  it('서버 검증 에러(마케팅 야간)를 입력란에 보인다', async () => {
    mockFetch((c) =>
      c.method === 'POST' && c.path === '/notices'
        ? {
            status: 400,
            body: apiError('VALIDATION_FAILED', {
              fieldErrors: [{ path: 'scheduledAt', code: 'night_not_allowed' }],
            }),
          }
        : undefined,
    );
    const user = userEvent.setup();
    render(<NoticeFormView notice={null} role="owner" onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('제목'), '제목');
    await user.type(screen.getByLabelText('본문'), '본문');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('마케팅은 08:00~20:59에만 보낼 수 있어요')).toBeInTheDocument();
  });

  it('발송된 공지는 읽기 전용 (수정·발송 버튼 없음)', () => {
    mockFetch(() => undefined);
    render(<NoticeFormView notice={notice({ status: 'sent' })} role="owner" onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '발송' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('제목')).toBeDisabled();
    expect(screen.getByText(/발송된 공지는 수정할 수 없어요/)).toBeInTheDocument();
  });
});
