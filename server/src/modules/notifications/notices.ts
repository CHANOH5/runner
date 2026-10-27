import type { NoticeDetail } from '@berun/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notices } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { toKstIso } from '../../lib/time.js';

/**
 * GET /notices/{id} — 공지 상세 (tech/06 6.5, PRD 8.6).
 * 보낸 공지(sent)만 보인다. 내린 공지는 410 NOTICE_WITHDRAWN, 작성 중·발송 대기는 404.
 * 게시 시각: 예약 공지는 예약 시각, 즉시 공지는 승인 시각 (notices에 발송 시각 컬럼이 따로 없다).
 */
export async function getNotice(db: Db, id: string): Promise<NoticeDetail> {
  const [n] = await db.select().from(notices).where(eq(notices.id, id));
  if (!n) throw notFound('notice');
  if (n.status === 'withdrawn') throw new AppError('NOTICE_WITHDRAWN', 'notice withdrawn');
  if (n.status !== 'sent') throw notFound('notice');

  const link: NoticeDetail['link'] =
    n.linkType === 'race' && n.linkRaceId
      ? { type: 'race', raceId: n.linkRaceId }
      : n.linkType === 'race_list'
        ? { type: 'race_list' }
        : // 공지만, 또는 연결된 대회가 삭제됨(link_race_id = null) → 이동 버튼 없음
          { type: 'notice' };
  return {
    id: n.id,
    kind: n.kind === 'marketing' ? 'marketing' : 'notice',
    title: n.title,
    body: n.body,
    publishedAt: toKstIso(n.scheduledAt ?? n.approvedAt ?? n.createdAt),
    link,
  };
}
