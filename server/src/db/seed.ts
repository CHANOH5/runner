/**
 * 개발용 시드. 고정 id + ON CONFLICT DO NOTHING이라 여러 번 실행해도 된다.
 * 대회는 실제 대회가 아니라 개발용 가상 데이터다 (이름에 [개발] 접두).
 */
import { sql } from 'drizzle-orm';
import { loadDatabaseUrl } from '../config/env.js';
import { addDays, kstDate } from '../lib/time.js';
import { createDb, type Db } from './client.js';
import {
  appConfigs,
  notificationSettings,
  privacySettings,
  raceEvents,
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
  devRegistration: '0199f000-0000-7000-8000-000000000301',
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

    await tx
      .insert(raceRegistrations)
      .values({
        id: SEED_IDS.devRegistration,
        userId: SEED_IDS.devUser,
        raceId: SEED_IDS.raceHangang,
        raceEventId: SEED_IDS.eventHangangHalf,
        goalTimeSec: 7199,
        goalPaceSecPerKm: Math.round(7199 / (21097 / 1000)),
      })
      .onConflictDoNothing();
  });
}

if (import.meta.filename === process.argv[1]) {
  const { db, client } = createDb(loadDatabaseUrl(), { max: 1 });
  try {
    await seed(db);
    console.warn('seed applied');
  } finally {
    await client.end();
  }
}
