import { z } from 'zod';
import { DateTime, Id } from './common.js';
import { Page, PageQuery } from './query.js';

/** tech/06 5장 */
export const NotificationKind = z.enum([
  'reg_open_d1',
  'reg_open_soon',
  'reg_close_d1',
  'race_d7',
  'race_d1',
  'race_cancelled',
  'race_postponed',
  'race_schedule_changed',
  'report_applied',
  'report_rejected',
  'notice',
  'marketing',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/** 앱 내 알림 (S-011) */
export const AppNotification = z.object({
  id: Id,
  kind: NotificationKind,
  /** 서버가 PRD 7.2 문구로 렌더링해 저장한 값 */
  title: z.string(),
  body: z.string(),
  /** berun://races/{id} 등 (PRD 7.3) */
  deepLink: z.string(),
  /** 알림 시각 (예약 발송 시각, 즉시 알림은 생성 시각). 정렬 기준 */
  createdAt: DateTime,
  readAt: DateTime.nullable(),
});
export type AppNotification = z.infer<typeof AppNotification>;

export const NotificationPage = Page(AppNotification);
export const NotificationListQuery = PageQuery;

export const UnreadCount = z.object({ count: z.number().int() });

/** POST /me/notifications/read */
export const MarkReadReq = z.union([
  z.object({ ids: z.array(Id).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkReadReq = z.infer<typeof MarkReadReq>;

/** 앱 내 알림 보존 기간 (PRD 7.1, P-RET) */
export const NOTIFICATION_RETENTION_DAYS = 90;
