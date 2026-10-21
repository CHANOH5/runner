import { describe, expect, it } from 'vitest';
import { effectiveWindow, eventClosesAt, registrationState } from './registration-window.js';

const kst = (s: string) => new Date(`${s}+09:00`);
const none = { registrationOpensAt: null, registrationClosesAt: null };
const race = (raceDate: string, status = 'scheduled') => ({ raceDate, status });
const NOW = kst('2026-10-21T12:00:00');

describe('effectiveWindow', () => {
  it('대회 기간이 있으면 그대로', () => {
    const w = effectiveWindow(
      { registrationOpensAt: kst('2026-10-01T10:00:00'), registrationClosesAt: null },
      [
        {
          registrationOpensAt: kst('2026-09-01T10:00:00'),
          registrationClosesAt: kst('2026-11-01T00:00:00'),
        },
      ],
    );
    expect(w).toEqual({ opensAt: kst('2026-10-01T10:00:00'), closesAt: null });
  });

  it('대회 기간이 비면 종목 중 가장 이른 오픈·가장 늦은 마감 (한쪽만 있는 값도 집계)', () => {
    const w = effectiveWindow(none, [
      { registrationOpensAt: kst('2026-10-05T10:00:00'), registrationClosesAt: null },
      {
        registrationOpensAt: kst('2026-10-01T10:00:00'),
        registrationClosesAt: kst('2026-10-20T18:00:00'),
      },
      { registrationOpensAt: null, registrationClosesAt: kst('2026-10-25T18:00:00') },
    ]);
    expect(w).toEqual({
      opensAt: kst('2026-10-01T10:00:00'),
      closesAt: kst('2026-10-25T18:00:00'),
    });
  });
});

describe('registrationState (PRD 4.5 순서)', () => {
  const open = { opensAt: kst('2026-10-01T10:00:00'), closesAt: kst('2026-10-31T18:00:00') };

  it('취소가 가장 먼저, 그다음 종료', () => {
    expect(registrationState(race('2026-10-01', 'cancelled'), open, NOW)).toBe('cancelled');
    expect(registrationState(race('2026-10-20'), open, NOW)).toBe('ended');
    expect(registrationState(race('2026-11-15', 'finished'), open, NOW)).toBe('ended');
  });

  it('오픈 없음 → 미정, 오픈 전 → 예정, 기간 안 → 접수 중, 마감 후 → 마감', () => {
    expect(registrationState(race('2026-11-15'), { opensAt: null, closesAt: null }, NOW)).toBe(
      'unscheduled',
    );
    expect(
      registrationState(
        race('2026-11-15'),
        { opensAt: kst('2026-10-22T10:00:00'), closesAt: null },
        NOW,
      ),
    ).toBe('upcoming');
    expect(registrationState(race('2026-11-15'), open, NOW)).toBe('open');
    expect(
      registrationState(race('2026-11-15'), { ...open, closesAt: kst('2026-10-21T12:00:00') }, NOW),
    ).toBe('closed');
  });

  it('마감이 없으면 대회 전날 23:59:59 KST까지 접수 중', () => {
    const w = { opensAt: kst('2026-10-01T10:00:00'), closesAt: null };
    expect(registrationState(race('2026-10-22'), w, kst('2026-10-21T23:59:59'))).toBe('open');
    expect(registrationState(race('2026-10-22'), w, kst('2026-10-22T00:00:00'))).toBe('closed');
  });

  it('대회 당일은 종료가 아니다', () => {
    expect(registrationState(race('2026-10-21'), open, NOW)).not.toBe('ended');
  });
});

describe('eventClosesAt', () => {
  it('종목 마감 → 없으면 유효 마감', () => {
    const w = { opensAt: null, closesAt: kst('2026-10-31T18:00:00') };
    expect(eventClosesAt({ ...none, registrationClosesAt: kst('2026-10-25T18:00:00') }, w)).toEqual(
      kst('2026-10-25T18:00:00'),
    );
    expect(eventClosesAt(none, w)).toEqual(kst('2026-10-31T18:00:00'));
    expect(eventClosesAt(none, { opensAt: null, closesAt: null })).toBeNull();
  });
});
