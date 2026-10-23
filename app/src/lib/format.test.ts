import {
  addDaysKst,
  daysBetween,
  formatDate,
  formatDateTime,
  formatDDay,
  formatDistance,
  formatDuration,
  formatHoursMinutes,
  formatKm,
  formatPace,
  formatRelative,
  hmsToSec,
  todayKst,
} from './format';

describe('표기 규칙 (PRD 3.1·3.2)', () => {
  it('기록: 1시간 이상 h:mm:ss, 미만 mm:ss', () => {
    expect(formatDuration(7110)).toBe('1:58:30');
    expect(formatDuration(3300)).toBe('55:00');
    expect(formatHoursMinutes(9000)).toBe('2:30');
  });

  it('페이스 m\'ss"/km, 거리 표기', () => {
    expect(formatPace(338)).toBe(`5'38"/km`);
    expect(formatDistance(21097, 'half')).toBe('하프');
    expect(formatDistance(12500, 'other')).toBe('12.5km');
    expect(formatKm(21097)).toBe('21.1km');
  });

  it('날짜·시각은 KST로 표시한다 (기기 시간대 무관)', () => {
    expect(formatDate('2026-11-08')).toBe('2026.11.08 (일)');
    expect(formatDateTime('2026-08-01T01:00:00Z')).toBe('2026.08.01 (토) 10:00');
    // UTC 15:30 = KST 다음 날 00:30
    expect(todayKst(new Date('2026-10-22T15:30:00Z'))).toBe('2026-10-23');
  });

  it('D-day: 당일 D-DAY, 지난 대회 표시 안 함', () => {
    expect(formatDDay(0)).toBe('D-DAY');
    expect(formatDDay(1)).toBe('D-1');
    expect(formatDDay(null)).toBeNull();
  });

  it('상대 시각: 7일 넘으면 날짜', () => {
    const now = new Date('2026-10-23T12:00:00+09:00');
    expect(formatRelative('2026-10-23T09:00:00+09:00', now)).toBe('3시간 전');
    expect(formatRelative('2026-10-10T09:00:00+09:00', now)).toBe('2026.10.10');
  });

  it('시·분·초 입력 → 초 (범위 밖은 null)', () => {
    expect(hmsToSec('1', '58', '0')).toBe(7080);
    expect(hmsToSec('', '50', '')).toBe(3000);
    expect(hmsToSec('0', '60', '0')).toBeNull();
    expect(addDaysKst('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-10-23', '2026-11-15')).toBe(23);
  });
});
