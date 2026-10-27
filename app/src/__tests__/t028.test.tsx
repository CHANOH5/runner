import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../api';
import { ApiError } from '../api/client';
import Races from '../app/(tabs)/races';
import NoticeScreen from '../app/notices/[noticeId]';
import RaceFilter from '../app/races/filter';
import { EMPTY_FILTERS, useRaceFilters } from '../features/raceFilters';
import { todayKst } from '../lib/format';
import { race } from '../test/fixtures';
import { renderScreen, type mockApiModule } from '../test/render';

jest.mock('../api', () => require('../test/render').mockApiModule());

const mocked = api as unknown as ReturnType<typeof mockApiModule>['api'];
const today = todayKst();
const month = today.slice(0, 7);
const pastDay = `${month}-01` < today ? `${month}-01` : null;

const summary = (id: string, over: object = {}) => {
  const {
    events: _e,
    venue: _v,
    organizer: _o,
    earliestStartAt: _s,
    officialUrl: _u,
    registrationUrl: _r,
    courseUrl: _c,
    source: _src,
    lastVerifiedAt: _l,
    my: _m,
    ...rest
  } = race();
  return { ...rest, id, name: `대회 ${id}`, my: { interested: false, registered: false }, ...over };
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mocked))
    fn.mockReset().mockImplementation(() => new Promise(() => undefined));
});

describe('S-020 캘린더 — 지난 날짜 (PRD v1.12 4.5)', () => {
  beforeEach(() =>
    useRaceFilters.setState({ filters: EMPTY_FILTERS, view: 'calendar', loaded: true }),
  );

  it('달력·날짜 목록 둘 다 includeEnded=true, 지난 날짜도 개수와 그날 목록(종료)을 보인다', async () => {
    if (!pastDay) return; // 매달 1일에는 이번 달에 지난 날짜가 없다
    mocked.raceCalendar!.mockResolvedValue({ month, days: [{ date: pastDay, count: 2 }] });
    mocked.races!.mockImplementation((q: { date?: string }) =>
      Promise.resolve({
        items:
          q.date === pastDay
            ? [
                summary('p1', { raceDate: pastDay, registrationState: 'ended', dDay: null }),
                summary('p2', { raceDate: pastDay, registrationState: 'ended', dDay: null }),
              ]
            : [],
        nextCursor: null,
      }),
    );
    const user = userEvent.setup();
    await renderScreen(<Races />);
    await waitFor(() =>
      expect(mocked.raceCalendar).toHaveBeenCalledWith(month, { includeEnded: true }),
    );
    const cell = await screen.findByLabelText(`${pastDay} 대회 2개`);
    await user.press(cell);
    expect(await screen.findByText('대회 p1')).toBeOnTheScreen();
    expect(screen.getByText('대회 p2')).toBeOnTheScreen();
    expect(screen.getAllByText('종료').length).toBe(2);
    expect(mocked.races).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: pastDay, includeEnded: true }),
    );
  });

  it('필터는 달력과 날짜 목록에 똑같이 적용된다', async () => {
    useRaceFilters.setState({
      filters: { ...EMPTY_FILTERS, region: ['seoul'], hideCancelled: true },
    });
    mocked.raceCalendar!.mockResolvedValue({ month, days: [] });
    mocked.races!.mockResolvedValue({ items: [], nextCursor: null });
    await renderScreen(<Races />);
    expect(await screen.findByText('이 날은 대회가 없어요')).toBeOnTheScreen();
    const filters = { region: ['seoul'], hideCancelled: true, includeEnded: true };
    expect(mocked.raceCalendar).toHaveBeenCalledWith(month, filters);
    expect(mocked.races).toHaveBeenCalledWith(expect.objectContaining({ ...filters, date: today }));
  });
});

describe('S-021 필터 결과 수 (GET /races/count)', () => {
  it('"n개 대회 보기", 0개면 비활성, 캘린더 안내 문구', async () => {
    useRaceFilters.setState({ filters: EMPTY_FILTERS, view: 'list', loaded: true });
    mocked.raceCount!.mockResolvedValue({ count: 128 });
    await renderScreen(<RaceFilter />);
    expect(await screen.findByRole('button', { name: '128개 대회 보기' })).toBeEnabled();
    expect(screen.getByText('캘린더는 지난 날짜도 함께 보여요')).toBeOnTheScreen();
    expect(mocked.raceCount).toHaveBeenCalledWith({});
    expect(mocked.races).not.toHaveBeenCalled();
  });

  it('0개면 버튼 비활성 + 안내', async () => {
    mocked.raceCount!.mockResolvedValue({ count: 0 });
    await renderScreen(<RaceFilter />);
    expect(await screen.findByRole('button', { name: '0개 대회 보기' })).toBeDisabled();
    expect(screen.getByText('조건에 맞는 대회가 없어요')).toBeOnTheScreen();
  });
});

describe('공지 상세 (GET /notices/{id})', () => {
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ noticeId: 'n1' }));

  it('제목·본문(링크)·대회 이동 버튼', async () => {
    mocked.notice!.mockResolvedValue({
      id: '0199f000-0000-7000-8000-000000000601',
      kind: 'notice',
      title: '서비스 점검 안내',
      body: '자세한 내용: https://example.test/notice',
      publishedAt: '2026-10-27T10:00:00+09:00',
      link: { type: 'race', raceId: '0199f000-0000-7000-8000-000000000101' },
    });
    const user = userEvent.setup();
    await renderScreen(<NoticeScreen />);
    expect(await screen.findByText('서비스 점검 안내')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'https://example.test/notice' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: '대회 보기' }));
    expect(router.push).toHaveBeenCalledWith('/races/0199f000-0000-7000-8000-000000000101');
    expect(mocked.notice).toHaveBeenCalledWith('n1');
  });

  it('내린 공지(410) → 내려간 공지예요', async () => {
    mocked.notice!.mockRejectedValue(new ApiError(410, 'NOTICE_WITHDRAWN'));
    await renderScreen(<NoticeScreen />);
    expect(await screen.findByText('내려간 공지예요')).toBeOnTheScreen();
  });
});
