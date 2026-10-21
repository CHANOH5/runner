import { describe, expect, it } from 'vitest';
import { computeSchedules } from './schedule.js';

const kst = (s: string) => new Date(`${s}+09:00`);
const NOW = kst('2026-10-21T12:00:00');

type Race = Parameters<typeof computeSchedules>[0];
type Event = Parameters<typeof computeSchedules>[1][number];

const race = (over: Partial<Race> = {}): Race =>
  ({
    id: 'r',
    publishStatus: 'published',
    status: 'scheduled',
    raceDate: '2027-03-15',
    registrationOpensAt: kst('2026-11-01T10:00:00'),
    registrationOpensTimeKnown: true,
    registrationClosesAt: kst('2026-11-15T23:59:00'),
    ...over,
  }) as Race;
const event = (over: Partial<Event> = {}): Event =>
  ({ id: 'e1', registrationOpensAt: null, registrationClosesAt: null, ...over }) as Event;

const view = (rows: ReturnType<typeof computeSchedules>) =>
  rows.map((r) => [r.kind, r.raceEventId, r.scheduledAt.toISOString()]);

describe('computeSchedules (PRD 7.4 예시 타임라인)', () => {
  it('N-01 오픈 전날 19:00, N-02 오픈 −10분, N-03 마감 전날 19:00, N-04 D-7 12:00, N-05 전날 19:00', () => {
    expect(view(computeSchedules(race(), [event()], NOW))).toEqual([
      ['reg_open_d1', null, kst('2026-10-31T19:00:00').toISOString()],
      ['reg_open_soon', null, kst('2026-11-01T09:50:00').toISOString()],
      ['reg_close_d1', null, kst('2026-11-14T19:00:00').toISOString()],
      ['race_d7', null, kst('2027-03-08T12:00:00').toISOString()],
      ['race_d1', null, kst('2027-03-14T19:00:00').toISOString()],
    ]);
  });

  it('오픈 시각 미정이면 N-02는 오픈일 09:00', () => {
    const rows = computeSchedules(
      race({ registrationOpensAt: kst('2026-11-01T00:00:00'), registrationOpensTimeKnown: false }),
      [],
      NOW,
    );
    expect(rows.find((r) => r.kind === 'reg_open_soon')?.scheduledAt).toEqual(
      kst('2026-11-01T09:00:00'),
    );
    expect(rows.find((r) => r.kind === 'reg_open_d1')?.scheduledAt).toEqual(
      kst('2026-10-31T19:00:00'),
    );
  });

  it('유효 마감이 없으면 N-03을 만들지 않는다, 종목별 마감은 종목 행으로 따로', () => {
    const noClose = computeSchedules(race({ registrationClosesAt: null }), [], NOW);
    expect(noClose.some((r) => r.kind === 'reg_close_d1')).toBe(false);

    const perEvent = computeSchedules(
      race(),
      [
        event({ id: 'half', registrationClosesAt: kst('2026-11-10T18:00:00') }),
        event({ id: 'full' }),
      ],
      NOW,
    );
    expect(
      perEvent.filter((r) => r.kind === 'reg_close_d1').map((r) => [r.raceEventId, r.scheduledAt]),
    ).toEqual([
      [null, kst('2026-11-14T19:00:00')],
      ['half', kst('2026-11-09T19:00:00')],
    ]);
  });

  it('대회 기간이 비면 종목 기간 집계로 계산', () => {
    const rows = computeSchedules(
      race({ registrationOpensAt: null, registrationClosesAt: null }),
      [
        event({
          registrationOpensAt: kst('2026-11-02T10:00:00'),
          registrationClosesAt: kst('2026-11-20T18:00:00'),
        }),
      ],
      NOW,
    );
    expect(rows.find((r) => r.kind === 'reg_open_soon')?.scheduledAt).toEqual(
      kst('2026-11-02T09:50:00'),
    );
    // 대회 단위 행 + 그 종목 행 (같은 시각)
    expect(rows.filter((r) => r.kind === 'reg_close_d1')).toHaveLength(2);
  });

  it('이미 지난 시각은 만들지 않는다', () => {
    const late = kst('2026-11-01T09:55:00');
    expect(view(computeSchedules(race(), [], late)).map((r) => r[0])).toEqual([
      'reg_close_d1',
      'race_d7',
      'race_d1',
    ]);
  });

  it('취소·종료·미게시 대회는 없음', () => {
    expect(computeSchedules(race({ status: 'cancelled' }), [], NOW)).toEqual([]);
    expect(computeSchedules(race({ status: 'finished' }), [], NOW)).toEqual([]);
    expect(computeSchedules(race({ publishStatus: 'hidden' }), [], NOW)).toEqual([]);
  });
});
