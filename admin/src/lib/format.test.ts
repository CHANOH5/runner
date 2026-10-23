import { describe, expect, it } from 'vitest';
import { parseLatLng, parseQuickDate, parseQuickTime, suggestCategory } from './format';

const NOW = new Date('2026-10-23T03:00:00Z'); // KST 10-23

describe('빠른 날짜·시각 입력 (PRD 8.4.1)', () => {
  it('2027-03-15 · 20270315 · 0315(가까운 미래)', () => {
    expect(parseQuickDate('2027-03-15', NOW)).toBe('2027-03-15');
    expect(parseQuickDate('20270315', NOW)).toBe('2027-03-15');
    expect(parseQuickDate('0315', NOW)).toBe('2027-03-15'); // 올해 3월은 지났으니 다음 해
    expect(parseQuickDate('1108', NOW)).toBe('2026-11-08');
    expect(parseQuickDate('1023', NOW)).toBe('2026-10-23'); // 오늘은 올해
    expect(parseQuickDate('2026.11.8', NOW)).toBe('2026-11-08');
    expect(parseQuickDate('20270230', NOW)).toBeNull();
    expect(parseQuickDate('내일', NOW)).toBeNull();
  });

  it('1000 → 10:00, 9 → 09:00, 930 → 09:30', () => {
    expect(['1000', '9', '930', '8:05', '2400', ''].map(parseQuickTime)).toEqual([
      '10:00',
      '09:00',
      '09:30',
      '08:05',
      null,
      null,
    ]);
  });

  it('좌표 붙여넣기, 분류 제안', () => {
    expect(parseLatLng('37.5665, 126.9780')).toEqual({ lat: 37.5665, lng: 126.978 });
    expect(parseLatLng('37.5 x')).toBeNull();
    expect([5000, 10000, 21097, 42195, 12500].map(suggestCategory)).toEqual([
      '5k',
      '10k',
      'half',
      'full',
      'other',
    ]);
  });
});
