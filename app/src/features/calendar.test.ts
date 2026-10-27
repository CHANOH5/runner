import {
  calendarCell,
  calendarDayQuery,
  calendarFilters,
  calendarMonthRange,
  lastDayOfMonth,
  monthShift,
} from './calendar';
import { splitLinks } from './notice';
import { EMPTY_FILTERS } from './raceFilters';

const TODAY = '2026-10-27';

describe('캘린더 요청 (PRD v1.12 4.5)', () => {
  it('"종료 포함"이 꺼져 있어도 달력·날짜 목록 둘 다 includeEnded=true', () => {
    expect(calendarFilters(EMPTY_FILTERS, TODAY)).toEqual({ includeEnded: true });
    expect(calendarDayQuery(EMPTY_FILTERS, TODAY, '2026-10-03')).toEqual({
      includeEnded: true,
      date: '2026-10-03',
    });
  });

  it('다른 필터는 두 요청에 똑같이, 기간 필터는 보내지 않는다', () => {
    const f = {
      ...EMPTY_FILTERS,
      region: ['seoul' as const],
      category: ['half' as const],
      hideCancelled: true,
      period: { preset: 'this_month' as const },
    };
    const cal = calendarFilters(f, TODAY);
    expect(cal).toEqual({
      region: ['seoul'],
      category: ['half'],
      hideCancelled: true,
      includeEnded: true,
    });
    const { date, ...dayRest } = calendarDayQuery(f, TODAY, '2026-10-30');
    expect(date).toBe('2026-10-30');
    expect(dayRest).toEqual(cal);
  });

  it('달 범위 −1 ~ +12, 달 이동·말일', () => {
    expect(calendarMonthRange(TODAY)).toEqual({ min: '2026-09', max: '2027-10' });
    expect(monthShift('2026-12', 1)).toBe('2027-01');
    expect(monthShift('2026-01', -1)).toBe('2025-12');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
  });

  it('칸 표시: 10개 이상 9+, 지난 날짜는 흐리게, 오늘 표시', () => {
    expect(calendarCell('2026-10-03', 2, TODAY)).toEqual({
      label: '2',
      past: true,
      isToday: false,
    });
    expect(calendarCell('2026-10-27', 12, TODAY)).toEqual({
      label: '9+',
      past: false,
      isToday: true,
    });
    expect(calendarCell('2026-11-01', 0, TODAY).label).toBeNull();
  });
});

describe('공지 본문 링크 (PRD 8.6)', () => {
  it('http(s) 주소만 링크, 문장 끝 마침표는 뺀다, 줄바꿈 유지', () => {
    expect(splitLinks('안내\n자세히: https://a.test/x?y=1. 감사합니다')).toEqual([
      { text: '안내\n자세히: ', url: null },
      { text: 'https://a.test/x?y=1', url: 'https://a.test/x?y=1' },
      { text: '. 감사합니다', url: null },
    ]);
    expect(splitLinks('링크 없음')).toEqual([{ text: '링크 없음', url: null }]);
  });
});
