import type { NotificationKind } from '@berun/shared';

/**
 * 딥링크 → 앱 경로 (PRD 7.3). berun://races/{id} → /races/{id} 처럼 스킴만 떼면 Expo Router 경로와 같다.
 * 알 수 없는 링크는 null.
 */
export function deepLinkToPath(link: string): string | null {
  const m = /^berun:\/\/(.+)$/.exec(link);
  if (!m) return null;
  const path = `/${m[1]!.replace(/^\/+/, '')}`;
  const known = [
    /^\/races\/[\w-]+$/,
    /^\/races\/[\w-]+\/register$/,
    /^\/registrations\/[\w-]+\/strategy$/,
    /^\/notices\/[\w-]+$/,
    /^\/notifications$/,
  ];
  return known.some((re) => re.test(path)) ? path : null;
}

/** 알림 종류별 아이콘 (S-011) */
export function notificationIcon(kind: NotificationKind): string {
  switch (kind) {
    case 'reg_open_d1':
    case 'reg_open_soon':
    case 'reg_close_d1':
      return '⏰';
    case 'race_d7':
    case 'race_d1':
      return '🏃';
    case 'race_cancelled':
    case 'race_postponed':
    case 'race_schedule_changed':
      return '⚠️';
    case 'report_applied':
    case 'report_rejected':
      return '✉️';
    case 'dormancy_notice':
      return '👤';
    default:
      return '📢';
  }
}
