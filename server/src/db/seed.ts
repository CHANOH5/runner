/**
 * 개발용 시드. 고정 id + ON CONFLICT DO NOTHING이라 여러 번 실행해도 된다.
 * 대회는 실제 대회가 아니라 개발용 가상 데이터다 (이름에 [개발] 접두).
 */
import { sql } from 'drizzle-orm';
import { loadDatabaseUrl } from '../config/env.js';
import { createTokenCipher, type TokenCipher } from '../lib/crypto.js';
import { hashPassword } from '../modules/admin/auth-service.js';
import { addDays, kstDate } from '../lib/time.js';
import { createDb, type Db } from './client.js';
import {
  adminUsers,
  appConfigs,
  authIdentities,
  notices,
  notifications,
  notificationSettings,
  privacySettings,
  raceEvents,
  raceInterests,
  raceRegistrations,
  races,
  raceSources,
  runRecords,
  termsVersions,
  userConsents,
  userProfiles,
  users,
} from './schema/index.js';

export const SEED_IDS = {
  devUser: '0199f000-0000-7000-8000-000000000001',
  raceHangang: '0199f000-0000-7000-8000-000000000101',
  raceBusan: '0199f000-0000-7000-8000-000000000102',
  raceChuncheon: '0199f000-0000-7000-8000-000000000103',
  raceDaeguFinished: '0199f000-0000-7000-8000-000000000104',
  raceJejuDraft: '0199f000-0000-7000-8000-000000000105',
  eventHangang10k: '0199f000-0000-7000-8000-000000000201',
  eventHangangHalf: '0199f000-0000-7000-8000-000000000202',
  eventBusan5k: '0199f000-0000-7000-8000-000000000203',
  eventBusan10k: '0199f000-0000-7000-8000-000000000204',
  eventChuncheon10k: '0199f000-0000-7000-8000-000000000205',
  eventChuncheonHalf: '0199f000-0000-7000-8000-000000000206',
  eventChuncheonFull: '0199f000-0000-7000-8000-000000000207',
  eventDaeguFull: '0199f000-0000-7000-8000-000000000208',
  eventJeju: '0199f000-0000-7000-8000-000000000209',
  raceIncheonClosed: '0199f000-0000-7000-8000-000000000106',
  eventIncheon10k: '0199f000-0000-7000-8000-000000000210',
  devRegistration: '0199f000-0000-7000-8000-000000000301',
  devRegistrationClosed: '0199f000-0000-7000-8000-000000000302',
  noticeWelcome: '0199f000-0000-7000-8000-000000000501',
  noticeWithdrawn: '0199f000-0000-7000-8000-000000000502',
  devNoticeWelcome: '0199f000-0000-7000-8000-000000000511',
  devNoticeWithdrawn: '0199f000-0000-7000-8000-000000000512',
} as const;

const TERMS = [
  { id: '0199f000-0000-7000-8000-000000000401', kind: 'service', required: true },
  { id: '0199f000-0000-7000-8000-000000000402', kind: 'privacy', required: true },
  { id: '0199f000-0000-7000-8000-000000000403', kind: 'marketing', required: false },
  { id: '0199f000-0000-7000-8000-000000000404', kind: 'night_push', required: false },
] as const;

const kst = (local: string) => new Date(`${local}+09:00`);

type RaceSeed = typeof races.$inferInsert & {
  id: string;
  venue?: { lat: number; lng: number };
  events: (typeof raceEvents.$inferInsert)[];
};

function raceSeeds(now: Date): RaceSeed[] {
  const verified = now;
  return [
    {
      id: SEED_IDS.raceHangang,
      name: '[개발] 한강 가을 하프마라톤',
      slug: 'dev-hangang-autumn-half-2026',
      organizer: '개발 러닝 협회',
      regionCode: 'seoul',
      venueName: '여의도 한강공원 이벤트광장',
      venueAddress: '서울 영등포구 여의동로 330',
      venue: { lat: 37.5284, lng: 126.9327 },
      raceDate: '2026-11-15',
      registrationOpensAt: kst('2026-09-01T10:00:00'),
      registrationClosesAt: kst('2026-10-31T18:00:00'),
      status: 'scheduled',
      publishStatus: 'published',
      registrationMethod: 'first_come',
      dedupeKey: '한강가을하프마라톤|2026-11-15',
      officialUrl: 'https://example.com/hangang-half',
      registrationUrl: 'https://example.com/hangang-half/apply',
      lastVerifiedAt: verified,
      events: [
        {
          id: SEED_IDS.eventHangang10k,
          raceId: SEED_IDS.raceHangang,
          name: '10km',
          category: '10k',
          distanceM: 10000,
          startAt: kst('2026-11-15T08:30:00'),
          timeLimitMin: 90,
          feeKrw: 40000,
          capacity: 3000,
        },
        {
          id: SEED_IDS.eventHangangHalf,
          raceId: SEED_IDS.raceHangang,
          name: '하프코스',
          category: 'half',
          distanceM: 21097,
          startAt: kst('2026-11-15T08:00:00'),
          timeLimitMin: 150,
          feeKrw: 50000,
          capacity: 5000,
        },
      ],
    },
    {
      id: SEED_IDS.raceBusan,
      name: '[개발] 부산 바다 10K',
      slug: 'dev-busan-sea-10k-2026',
      organizer: '개발 스포츠',
      regionCode: 'busan',
      venueName: '광안리 해수욕장',
      venueAddress: '부산 수영구 광안해변로 219',
      venue: { lat: 35.1532, lng: 129.1186 },
      raceDate: '2026-12-06',
      registrationOpensAt: kst('2026-11-02T10:00:00'),
      registrationClosesAt: kst('2026-11-25T23:59:59'),
      publishStatus: 'published',
      registrationMethod: 'first_come',
      dedupeKey: '부산바다10k|2026-12-06',
      officialUrl: 'https://example.com/busan-10k',
      lastVerifiedAt: verified,
      events: [
        {
          id: SEED_IDS.eventBusan5k,
          raceId: SEED_IDS.raceBusan,
          name: '5km',
          category: '5k',
          distanceM: 5000,
          startAt: kst('2026-12-06T09:30:00'),
          timeLimitMin: 60,
          feeKrw: 30000,
        },
        {
          id: SEED_IDS.eventBusan10k,
          raceId: SEED_IDS.raceBusan,
          name: '10km',
          category: '10k',
          distanceM: 10000,
          startAt: kst('2026-12-06T09:00:00'),
          timeLimitMin: 90,
          feeKrw: 35000,
        },
      ],
    },
    {
      id: SEED_IDS.raceChuncheon,
      name: '[개발] 춘천 호반 마라톤',
      slug: 'dev-chuncheon-lake-marathon-2027',
      organizer: '개발 마라톤 조직위원회',
      regionCode: 'gangwon',
      venueName: '공지천 조각공원',
      venueAddress: null,
      raceDate: '2027-04-04',
      // 오픈일만 공지되고 시각은 미정 (PRD 4.7, N-02는 09:00)
      registrationOpensAt: kst('2027-01-12T00:00:00'),
      registrationOpensTimeKnown: false,
      registrationMethod: 'lottery',
      publishStatus: 'published',
      dedupeKey: '춘천호반마라톤|2027-04-04',
      officialUrl: 'https://example.com/chuncheon',
      courseUrl: 'https://example.com/chuncheon/course',
      lastVerifiedAt: verified,
      events: [
        {
          id: SEED_IDS.eventChuncheon10k,
          raceId: SEED_IDS.raceChuncheon,
          name: '10km',
          category: '10k',
          distanceM: 10000,
          startAt: null,
        },
        {
          id: SEED_IDS.eventChuncheonHalf,
          raceId: SEED_IDS.raceChuncheon,
          name: '하프코스',
          category: 'half',
          distanceM: 21097,
          startAt: null,
        },
        {
          id: SEED_IDS.eventChuncheonFull,
          raceId: SEED_IDS.raceChuncheon,
          name: '풀코스',
          category: 'full',
          distanceM: 42195,
          startAt: null,
          timeLimitMin: 300,
        },
      ],
    },
    {
      id: SEED_IDS.raceDaeguFinished,
      name: '[개발] 대구 가을 마라톤',
      slug: 'dev-daegu-autumn-marathon-2026',
      regionCode: 'daegu',
      raceDate: '2026-10-04',
      registrationOpensAt: kst('2026-07-01T10:00:00'),
      registrationClosesAt: kst('2026-09-15T18:00:00'),
      status: 'finished',
      publishStatus: 'published',
      dedupeKey: '대구가을마라톤|2026-10-04',
      officialUrl: 'https://example.com/daegu',
      lastVerifiedAt: verified,
      events: [
        {
          id: SEED_IDS.eventDaeguFull,
          raceId: SEED_IDS.raceDaeguFinished,
          name: '풀코스',
          category: 'full',
          distanceM: 42195,
          startAt: kst('2026-10-04T08:00:00'),
          timeLimitMin: 300,
        },
      ],
    },
    {
      // 접수 마감된 예정 대회 (참가 예정 접수 상태 'registered' 예시)
      id: SEED_IDS.raceIncheonClosed,
      name: '[개발] 인천 겨울 10K',
      slug: 'dev-incheon-winter-10k-2026',
      regionCode: 'incheon',
      venueName: '송도 센트럴파크',
      raceDate: '2026-12-13',
      registrationOpensAt: kst('2026-09-01T10:00:00'),
      registrationClosesAt: kst('2026-10-10T18:00:00'),
      publishStatus: 'published',
      registrationMethod: 'first_come',
      dedupeKey: '인천겨울10k|2026-12-13',
      officialUrl: 'https://example.com/incheon-10k',
      lastVerifiedAt: verified,
      events: [
        {
          id: SEED_IDS.eventIncheon10k,
          raceId: SEED_IDS.raceIncheonClosed,
          name: '10km',
          category: '10k',
          distanceM: 10000,
          startAt: kst('2026-12-13T09:00:00'),
          timeLimitMin: 90,
          feeKrw: 30000,
        },
      ],
    },
    {
      // 게시 전 초안 (앱 API에 보이면 안 됨)
      id: SEED_IDS.raceJejuDraft,
      name: '[개발] 제주 오름 트레일',
      slug: 'dev-jeju-oreum-trail-2027',
      regionCode: 'jeju',
      raceDate: '2027-05-16',
      raceType: 'trail',
      publishStatus: 'draft',
      dedupeKey: '제주오름트레일|2027-05-16',
      events: [
        {
          id: SEED_IDS.eventJeju,
          raceId: SEED_IDS.raceJejuDraft,
          name: '25km',
          category: 'other',
          distanceM: 25000,
        },
      ],
    },
  ];
}

/**
 * 개발용 관리자 (owner). 로컬 전용 값 — 운영 첫 owner는 배포 시 별도 시드 (PRD 8.2).
 * TOTP 비밀키는 RFC 문서 예시 값. 현재 코드: pnpm --filter @berun/server dev:admin-totp
 */
export const DEV_ADMIN = {
  id: '0199f000-0000-7000-8000-000000000901',
  email: 'dev-owner@example.com',
  password: 'dev-owner-password-local-only',
  totpSecret: 'JBSWY3DPEHPK3PXP',
} as const;

/** 개발용 시드·값은 운영에서 쓰지 않는다 — NODE_ENV=production이면 거부 (T-024) */
export function assertNotProduction(what: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${what}: 개발 전용 — NODE_ENV=production에서는 실행하지 않습니다`);
  }
}

export async function seedDevAdmin(db: Db, cipher: TokenCipher) {
  assertNotProduction('dev admin seed');
  await db
    .insert(adminUsers)
    .values({
      id: DEV_ADMIN.id,
      email: DEV_ADMIN.email,
      role: 'owner',
      passwordHash: await hashPassword(DEV_ADMIN.password),
      totpSecretEnc: cipher.encrypt(DEV_ADMIN.totpSecret),
    })
    .onConflictDoNothing();
}

export async function seed(db: Db, now = new Date()): Promise<void> {
  const today = kstDate(now);

  await db.transaction(async (tx) => {
    await tx
      .insert(termsVersions)
      .values(
        TERMS.map((t) => ({
          ...t,
          version: '1.0',
          contentUrl: `https://example.com/terms/${t.kind}/1.0`,
          effectiveAt: kst('2026-10-01T00:00:00'),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(appConfigs)
      .values([
        { key: 'min_native_version_ios', value: '1.0.0' },
        { key: 'min_native_version_android', value: '1.0.0' },
        { key: 'maintenance', value: { active: false, until: null } },
        // support_email은 고객센터 이메일 확정 후 (PRD Q-12)
      ])
      .onConflictDoNothing();

    for (const { events, venue, ...race } of raceSeeds(now)) {
      await tx.insert(races).values(race).onConflictDoNothing();
      if (venue) {
        await tx.execute(
          sql`UPDATE races SET venue_point = ST_SetSRID(ST_MakePoint(${venue.lng}, ${venue.lat}), 4326)::geography WHERE id = ${race.id}`,
        );
      }
      await tx.insert(raceEvents).values(events).onConflictDoNothing();
      if (race.publishStatus === 'published') {
        await tx
          .insert(raceSources)
          .values({
            raceId: race.id,
            sourceKind: 'official',
            sourceName: '공식 홈페이지',
            sourceUrl: race.officialUrl,
            isPrimary: true,
            fetchedAt: now,
          })
          .onConflictDoNothing();
      }
    }

    // 개발용 사용자 (dev:token으로 이 사용자의 access token을 만든다)
    await tx
      .insert(users)
      .values({ id: SEED_IDS.devUser, email: 'dev@example.com', birthYear: 1992 })
      .onConflictDoNothing();
    await tx
      .insert(authIdentities)
      .values({ userId: SEED_IDS.devUser, provider: 'kakao', providerUid: 'dev-kakao-1' })
      .onConflictDoNothing();
    await tx
      .insert(userProfiles)
      .values({ userId: SEED_IDS.devUser, nickname: '개발러너', regionCode: 'seoul' })
      .onConflictDoNothing();
    await tx.insert(privacySettings).values({ userId: SEED_IDS.devUser }).onConflictDoNothing();
    await tx
      .insert(notificationSettings)
      .values({ userId: SEED_IDS.devUser })
      .onConflictDoNothing();
    const consentCount = await tx.$count(userConsents, sql`user_id = ${SEED_IDS.devUser}`);
    if (consentCount === 0) {
      await tx.insert(userConsents).values(
        TERMS.filter((t) => t.required).map((t) => ({
          userId: SEED_IDS.devUser,
          termsVersionId: t.id,
          action: 'agree',
        })),
      );
    }

    // PRD 5.7 예시 1과 같은 10K 기록 3개 (오늘 기준 60·150·300일 전)
    await tx
      .insert(runRecords)
      .values(
        [
          { days: 60, sec: 3300, id: '0199f000-0000-7000-8000-000000000501' },
          { days: 150, sec: 3390, id: '0199f000-0000-7000-8000-000000000502' },
          { days: 300, sec: 3430, id: '0199f000-0000-7000-8000-000000000503' },
        ].map((r) => ({
          id: r.id,
          userId: SEED_IDS.devUser,
          distanceM: 10000,
          durationSec: r.sec,
          runDate: addDays(today, -r.days),
          category: '10k',
          kind: 'race',
        })),
      )
      .onConflictDoNothing();

    // 참가 예정 2건: 접수 중 대회는 접수 전, 마감된 대회는 접수 완료 (D-019)
    await tx
      .insert(raceRegistrations)
      .values([
        {
          id: SEED_IDS.devRegistration,
          userId: SEED_IDS.devUser,
          raceId: SEED_IDS.raceHangang,
          raceEventId: SEED_IDS.eventHangangHalf,
          goalTimeSec: 7199,
          goalPaceSecPerKm: Math.round(7199 / (21097 / 1000)),
          goalSource: 'manual',
          entryStatus: 'not_registered',
        },
        {
          id: SEED_IDS.devRegistrationClosed,
          userId: SEED_IDS.devUser,
          raceId: SEED_IDS.raceIncheonClosed,
          raceEventId: SEED_IDS.eventIncheon10k,
          entryStatus: 'registered',
          entryStatusUpdatedAt: now,
          entryStatusSource: 'form',
        },
      ])
      .onConflictDoNothing();
    // 관심: 참가 예정 대회(자동 켜짐과 같게) + 부산 대회(관심만)
    await tx
      .insert(raceInterests)
      .values(
        [SEED_IDS.raceHangang, SEED_IDS.raceIncheonClosed, SEED_IDS.raceBusan].map((raceId) => ({
          userId: SEED_IDS.devUser,
          raceId,
        })),
      )
      .onConflictDoNothing();

    // 공지 (N-08): 관리자 공지 작성 API 전이라 시드로만 넣는다. 하나는 보낸 공지, 하나는 내린 공지(410 확인용)
    const sentAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const noticeSeeds = [
      {
        id: SEED_IDS.noticeWelcome,
        title: '[개발] BeRun에 오신 걸 환영해요',
        body: '관심 대회를 등록하면 접수 오픈·마감 전에 알려드려요.\n자세한 안내는 https://example.com/notice 에서 볼 수 있어요.',
        linkType: 'race_list',
        status: 'sent',
        notificationId: SEED_IDS.devNoticeWelcome,
      },
      {
        id: SEED_IDS.noticeWithdrawn,
        title: '[개발] 내려간 공지',
        body: '관리자가 내린 공지예요. 상세를 열면 "내려간 공지예요"가 보여야 해요.',
        linkType: 'notice',
        status: 'withdrawn',
        notificationId: SEED_IDS.devNoticeWithdrawn,
      },
    ] as const;
    for (const { notificationId, ...n } of noticeSeeds) {
      await tx
        .insert(notices)
        .values({
          ...n,
          kind: 'notice',
          createdBy: DEV_ADMIN.id,
          approvedBy: DEV_ADMIN.id,
          approvedAt: sentAt,
        })
        .onConflictDoNothing();
      await tx
        .insert(notifications)
        .values({
          id: notificationId,
          userId: SEED_IDS.devUser,
          noticeId: n.id,
          kind: 'notice',
          payload: {
            title: n.title,
            body: n.body.split('\n')[0],
            deepLink: `berun://notices/${n.id}`,
          },
          scheduledAt: sentAt,
          status: 'sent',
          sentAt,
          createdAt: sentAt,
        })
        .onConflictDoNothing();
    }
  });
}

if (import.meta.filename === process.argv[1]) {
  assertNotProduction('db:seed');
  const { db, client } = createDb(loadDatabaseUrl(), { max: 1 });
  try {
    await seed(db);
    const key = process.env.TOKEN_ENC_KEY;
    if (key) {
      await seedDevAdmin(db, createTokenCipher(key));
      console.warn(`dev admin: ${DEV_ADMIN.email}`);
    } else {
      console.warn('TOKEN_ENC_KEY 없음 — 개발용 관리자 시드를 건너뜀');
    }
    console.warn('seed applied');
  } finally {
    await client.end();
  }
}
