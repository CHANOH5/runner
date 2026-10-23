import { checkGoal } from './goal';
import { defaultEntryStatus, planBlockReason, raceBadges, showNotRegisteredHint } from './race';

describe('목표 기록 검증 (PRD 4.10 ④)', () => {
  it('하프 1:58:00 → 목표 페이스 336초/km (= round(7080 ÷ 21.097))', () => {
    expect(checkGoal(7080, 21097, null)).toEqual({ paceSecPerKm: 336, error: null, warning: null });
  });

  it('풀 1:50:00 (2\'36"/km) → 다시 확인', () => {
    expect(checkGoal(6600, 42195, null).error).toBe('목표 기록을 다시 확인해주세요');
  });

  it('제한 시간 5시간 풀, 목표 5:20:00 → 경고만 (저장 가능)', () => {
    const r = checkGoal(5 * 3600 + 20 * 60, 42195, 300);
    expect(r.error).toBeNull();
    expect(r.warning).toBe('제한 시간(5:00)보다 길어요. 완주 인정이 안 될 수 있어요');
  });

  it('목표 없음은 검사하지 않는다', () => {
    expect(checkGoal(null, 21097, 150)).toEqual({ paceSecPerKm: null, error: null, warning: null });
  });
});

describe('참가 예정·접수 상태 규칙', () => {
  it('S-023 접수 상태 기본값: 접수 마감이면 접수 완료, 그 외 접수 전 (PRD 4.10 3-1)', () => {
    expect(defaultEntryStatus('closed')).toBe('registered');
    for (const s of ['upcoming', 'open', 'unscheduled'] as const)
      expect(defaultEntryStatus(s)).toBe('not_registered');
  });

  it('[참가 예정 추가] 비활성: 취소·지난 대회', () => {
    expect(planBlockReason({ status: 'cancelled', registrationState: 'cancelled', dDay: 10 })).toBe(
      'cancelled',
    );
    expect(planBlockReason({ status: 'finished', registrationState: 'ended', dDay: null })).toBe(
      'ended',
    );
    expect(planBlockReason({ status: 'postponed', registrationState: 'open', dDay: 3 })).toBeNull();
  });

  it('"아직 접수 전이에요" 안내: 접수 전 + 대회 접수 중일 때만', () => {
    expect(showNotRegisteredHint({ registrationState: 'open' }, 'not_registered')).toBe(true);
    expect(showNotRegisteredHint({ registrationState: 'open' }, 'registered')).toBe(false);
    expect(showNotRegisteredHint({ registrationState: 'closed' }, 'not_registered')).toBe(false);
  });

  it('배지: 접수 예정 7일 이내 D-n, 연기, 접수 방식 (PRD 4.5)', () => {
    const now = new Date('2026-10-23T12:00:00+09:00');
    const badges = raceBadges(
      {
        registrationState: 'upcoming',
        registrationOpensAt: '2026-10-25T10:00:00+09:00',
        status: 'postponed',
        registrationMethod: 'lottery',
      },
      now,
    );
    expect(badges.map((b) => b.label)).toEqual(['접수 예정 D-2', '연기', '추첨']);
    expect(
      raceBadges(
        {
          registrationState: 'open',
          registrationOpensAt: null,
          status: 'scheduled',
          registrationMethod: 'unknown',
        },
        now,
      ).map((b) => b.label),
    ).toEqual(['접수 중']);
  });
});
