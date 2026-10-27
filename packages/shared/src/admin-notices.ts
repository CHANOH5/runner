import { z } from 'zod';
import { DateTime, Id } from './common.js';

/**
 * 관리자 공지·푸시 (A-008, PRD 8.6, tech/06 7.6)
 */
export const NoticeKind = z.enum(['notice', 'marketing']);
export type NoticeKind = z.infer<typeof NoticeKind>;

/** draft 작성 중 / approved 승인됨(예약 대기) / sent 게시·발송됨 / withdrawn 내림 */
export const NoticeStatus = z.enum(['draft', 'approved', 'sent', 'withdrawn']);
export type NoticeStatus = z.infer<typeof NoticeStatus>;

export const NoticeLink = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notice') }),
  z.object({ type: z.literal('race'), raceId: Id }),
  z.object({ type: z.literal('race_list') }),
]);
export type NoticeLink = z.infer<typeof NoticeLink>;

/** 마케팅 제목 접두 — 지울 수 없음 (PRD 8.6). 저장은 접두 없이, 앱·푸시에 낼 때 붙인다 */
export const MARKETING_TITLE_PREFIX = '(광고) ';
/** 마케팅 푸시 본문 끝 수신 거부 안내 (PRD 7.2 N-08b) */
export const MARKETING_OPT_OUT_TEXT = '수신 거부: 마이 > 설정 > 알림 설정';
/** 마케팅 발송 가능 시각 08:00~20:59 KST (P-NOTI-02) */
export const MARKETING_START_HOUR = 8;
export const MARKETING_END_HOUR = 21;

const codePoints = (s: string) => [...s].length;
const text = (max: number) =>
  z
    .string()
    .trim()
    .refine((s) => codePoints(s) >= 1, { params: { code: 'required' } })
    .refine((s) => codePoints(s) <= max, { params: { code: 'too_long' } });

/** POST /notices, PUT /notices/{id} (발송 전만) */
export const AdminNoticeInput = z.object({
  kind: NoticeKind,
  /** 1~30자 (마케팅 접두 제외) */
  title: text(30),
  /** 1~500자 (앱 내 공지 상세). 푸시 본문은 앞 60자 */
  body: text(500),
  sendPush: z.boolean(),
  link: NoticeLink,
  /** null = 승인 즉시. 마케팅은 08:00~20:59 KST만 (400 fieldErrors scheduledAt night_not_allowed) */
  scheduledAt: DateTime.nullable(),
});
export type AdminNoticeInput = z.infer<typeof AdminNoticeInput>;

/** 발송 결과 (PRD 8.6 "발송 수, 성공·실패 수, 열람 수") */
export const NoticeStats = z.object({
  /** 앱 내 알림을 만든 사용자 수 */
  recipients: z.number().int(),
  /** 푸시를 푸시 서비스에 넘김 */
  pushed: z.number().int(),
  /** 푸시 실패 (앱 내 알림은 남음) */
  failed: z.number().int(),
  /** 기기 토큰이 없어 앱 내만 */
  inAppOnly: z.number().int(),
  /** 아직 발송 대기 */
  pending: z.number().int(),
  /** 알림을 열어 읽음 */
  opened: z.number().int(),
});
export type NoticeStats = z.infer<typeof NoticeStats>;

export const AdminNotice = z.object({
  id: Id,
  kind: NoticeKind,
  /** 입력한 제목 (접두 없음) */
  title: z.string(),
  /** 앱·푸시에 나가는 제목 (마케팅은 "(광고) " 포함) */
  displayTitle: z.string(),
  body: z.string(),
  sendPush: z.boolean(),
  link: NoticeLink,
  /** 링크 대회 이름 (삭제됐으면 null) */
  linkRaceName: z.string().nullable(),
  scheduledAt: DateTime.nullable(),
  status: NoticeStatus,
  createdBy: z.object({ id: Id, email: z.string() }),
  approvedBy: z.object({ id: Id, email: z.string() }).nullable(),
  approvedAt: DateTime.nullable(),
  /** 게시(발송) 시각 — 예약이면 예약 시각, 즉시면 승인 시각 */
  publishedAt: DateTime.nullable(),
  createdAt: DateTime,
  stats: NoticeStats,
});
export type AdminNotice = z.infer<typeof AdminNotice>;

export const AdminNoticeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export const AdminNoticePage = z.object({
  items: z.array(AdminNotice),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminNoticePage = z.infer<typeof AdminNoticePage>;

/** GET /notices/{id}/audience — 확인 모달 (대상 수) */
export const NoticeAudience = z.object({
  /** 앱 내 공지를 받을 사용자 (공지: 활성 사용자 전체 / 마케팅: 마케팅 동의자) */
  recipients: z.number().int(),
  /** 그중 푸시 토큰이 있는 사용자 (sendPush일 때 의미) */
  pushable: z.number().int(),
});
export type NoticeAudience = z.infer<typeof NoticeAudience>;

/** POST /notices/{id}/test — 관리자 본인의 테스트 계정(사용자 id)으로 1건 */
export const NoticeTestReq = z.object({ userId: Id });
