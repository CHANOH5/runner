import {
  MARKETING_END_HOUR,
  MARKETING_OPT_OUT_TEXT,
  MARKETING_START_HOUR,
  MARKETING_TITLE_PREFIX,
  type AdminNotice,
  type AdminNoticeInput,
  type NoticeKind,
} from '@berun/shared';
import { kstIso, splitKst } from '@/lib/format';

/** A-008 작성 폼 상태 (PRD 8.6) */
export type NoticeForm = {
  kind: NoticeKind;
  title: string;
  body: string;
  sendPush: boolean;
  linkType: 'notice' | 'race' | 'race_list';
  linkRaceId: string;
  linkRaceName: string;
  timing: 'now' | 'scheduled';
  date: string;
  time: string;
};

export const emptyNoticeForm = (): NoticeForm => ({
  kind: 'notice',
  title: '',
  body: '',
  sendPush: true,
  linkType: 'notice',
  linkRaceId: '',
  linkRaceName: '',
  timing: 'now',
  date: '',
  time: '10:00',
});

export function noticeToForm(n: AdminNotice): NoticeForm {
  const { date, time } = splitKst(n.scheduledAt);
  return {
    kind: n.kind,
    title: n.title,
    body: n.body,
    sendPush: n.sendPush,
    linkType: n.link.type,
    linkRaceId: n.link.type === 'race' ? n.link.raceId : '',
    linkRaceName: n.linkRaceName ?? '',
    timing: n.scheduledAt ? 'scheduled' : 'now',
    date,
    time: time || '10:00',
  };
}

const cps = (s: string) => [...s].length;

/** 마케팅은 08:00~20:59 KST만 (P-NOTI-02). time = HH:mm */
export const isMarketingHour = (time: string) => {
  const h = Number(time.slice(0, 2));
  return h >= MARKETING_START_HOUR && h < MARKETING_END_HOUR;
};

/** 화면 검증 (서버도 같은 규칙으로 다시 검사) — 입력란 이름 → 문구 */
export function validateNoticeForm(f: NoticeForm): Record<string, string> {
  const e: Record<string, string> = {};
  const title = f.title.trim();
  const body = f.body.trim();
  if (!title) e.title = '제목을 입력해주세요';
  else if (cps(title) > 30) e.title = '제목은 30자까지예요';
  if (!body) e.body = '본문을 입력해주세요';
  else if (cps(body) > 500) e.body = '본문은 500자까지예요';
  if (f.linkType === 'race' && !f.linkRaceId) e.link = '이동할 대회를 골라주세요';
  if (f.timing === 'scheduled') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !/^\d{2}:\d{2}$/.test(f.time)) {
      e.scheduledAt = '예약 날짜와 시각을 입력해주세요';
    } else if (f.kind === 'marketing' && !isMarketingHour(f.time)) {
      e.scheduledAt = '마케팅은 08:00~20:59에만 보낼 수 있어요';
    }
  }
  return e;
}

export function formToInput(f: NoticeForm): AdminNoticeInput {
  return {
    kind: f.kind,
    title: f.title.trim(),
    body: f.body.trim(),
    sendPush: f.sendPush,
    link:
      f.linkType === 'race'
        ? { type: 'race', raceId: f.linkRaceId }
        : f.linkType === 'race_list'
          ? { type: 'race_list' }
          : { type: 'notice' },
    scheduledAt: f.timing === 'scheduled' ? kstIso(f.date, f.time) : null,
  };
}

/** 미리보기: 앱에 나가는 제목과 푸시 본문 (서버 noticePushBody와 같은 규칙) */
export function noticePreview(f: Pick<NoticeForm, 'kind' | 'title' | 'body'>) {
  const title =
    f.kind === 'marketing' ? `${MARKETING_TITLE_PREFIX}${f.title.trim()}` : f.title.trim();
  const flat = f.body.replace(/\s+/g, ' ').trim();
  const cut = (s: string, max: number) =>
    cps(s) <= max ? s : `${[...s].slice(0, max - 1).join('')}…`;
  const body =
    f.kind === 'marketing'
      ? `${cut(flat, 60 - cps(MARKETING_OPT_OUT_TEXT) - 1)} ${MARKETING_OPT_OUT_TEXT}`
      : cut(flat, 60);
  return { title, body };
}
