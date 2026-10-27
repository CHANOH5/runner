import { ageGate, nicknameFormatError, runningSinceError } from './profile';
import {
  customPeriodError,
  EMPTY_FILTERS,
  filterChips,
  filtersToQuery,
  periodRange,
} from './raceFilters';
import { emptyRecordForm, validateRecordForm, type RecordFormState } from './recordForm';
import { categoryOfDistance } from './findRaces';
import { deepLinkToPath } from './deepLink';

const TODAY = '2026-10-23';
const form = (over: Partial<RecordFormState>): RecordFormState => ({
  ...emptyRecordForm(TODAY),
  ...over,
});

describe('기록 입력 검증 (PRD 4.4 수용 기준)', () => {
  it('10K 0:18:00 (1\'48"/km) → 기록을 다시 확인해주세요', () => {
    const r = validateRecordForm(
      form({ category: '10k', duration: { h: '0', m: '18', s: '0' } }),
      TODAY,
    );
    expect(r.errors.duration).toBe('기록을 다시 확인해주세요');
    expect(r.values).toBeNull();
  });

  it('기타 0.5km → 1.0~100.0km 사이로 입력해주세요', () => {
    const r = validateRecordForm(
      form({ category: 'other', otherKm: '0.5', duration: { h: '', m: '5', s: '' } }),
      TODAY,
    );
    expect(r.errors.distance).toBe('1.0~100.0km 사이로 입력해주세요');
  });

  it('미래 날짜·0초는 저장할 수 없다', () => {
    const r = validateRecordForm(form({ category: '5k', runDate: '2026-10-24' }), TODAY);
    expect(r.errors.runDate).toBeDefined();
    expect(r.errors.duration).toBe('기록을 입력해주세요');
  });

  it('정상 입력 → 서버 요청 값 (기타 12.5km = 12500m, 빈 제목 null)', () => {
    const r = validateRecordForm(
      form({
        category: 'other',
        otherKm: '12.5',
        duration: { h: '1', m: '5', s: '0' },
        title: '  ',
      }),
      TODAY,
    );
    expect(r.values).toEqual({
      category: 'other',
      distanceM: 12500,
      durationSec: 3900,
      runDate: TODAY,
      kind: 'race',
      title: null,
    });
  });
});

describe('프로필 (PRD 4.3)', () => {
  it('만 14세 판정: 2013 → 중단, 2012 → 생일 질문, 2011 → 통과 (2026년)', () => {
    expect(ageGate(2013, 2026)).toBe('underage');
    expect(ageGate(2012, 2026)).toBe('ask');
    expect(ageGate(2011, 2026)).toBe('ok');
  });

  it('닉네임 형식·러닝 시작 연도', () => {
    expect(nicknameFormatError('러너 1')).not.toBeNull();
    expect(nicknameFormatError('가')).toBe('2~12자로 입력해주세요');
    expect(nicknameFormatError('BeRun_kim')).toBeNull(); // 예약어는 서버가 판정
    expect(runningSinceError(1994, 1990)).not.toBeNull();
    expect(runningSinceError(1995, 1990)).toBeNull();
  });
});

describe('대회 필터 (PRD 4.6)', () => {
  it('기간 프리셋 → from/to', () => {
    expect(periodRange({ preset: 'this_month' }, TODAY)).toEqual({ from: TODAY, to: '2026-10-31' });
    expect(periodRange({ preset: 'next_month' }, '2026-12-05')).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
    });
    expect(periodRange({ preset: 'three_months' }, TODAY)).toEqual({
      from: TODAY,
      to: '2027-01-23',
    });
  });

  it('필터 → 쿼리, 칩 해제', () => {
    const f = {
      ...EMPTY_FILTERS,
      region: ['seoul' as const],
      category: ['half' as const],
      hideCancelled: true,
    };
    expect(filtersToQuery(f, TODAY)).toEqual({
      region: ['seoul'],
      category: ['half'],
      hideCancelled: true,
    });
    const chips = filterChips(f);
    expect(chips.map((c) => c.label)).toEqual(['서울', '하프', '취소 대회 숨김']);
    expect(chips[0]!.remove(f).region).toEqual([]);
    expect(filtersToQuery(EMPTY_FILTERS, TODAY)).toEqual({});
  });

  it('직접 선택 기간: 최대 12개월', () => {
    expect(customPeriodError('2026-11-01', '2027-11-01')).toBeNull();
    expect(customPeriodError('2026-11-01', '2027-11-02')).toBe(
      '기간은 최대 12개월까지 고를 수 있어요',
    );
    expect(customPeriodError('2026-11-02', '2026-11-01')).toBe('시작일이 종료일보다 늦어요');
  });

  it('[이 거리 대회 찾기] 거리 → 분류', () => {
    expect(categoryOfDistance(21097)).toBe('half');
    expect(categoryOfDistance(15000)).toBe('other');
  });
});

describe('딥링크 (PRD 7.3)', () => {
  it('알려진 경로만 앱 경로로 바꾼다', () => {
    expect(deepLinkToPath('berun://races/abc')).toBe('/races/abc');
    expect(deepLinkToPath('berun://registrations/r1/strategy')).toBe('/registrations/r1/strategy');
    expect(deepLinkToPath('berun://notifications')).toBe('/notifications');
    expect(deepLinkToPath('berun://admin')).toBeNull();
    expect(deepLinkToPath('https://evil.test/races/1')).toBeNull();
  });
});
