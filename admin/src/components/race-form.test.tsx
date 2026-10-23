import type { AdminRace } from '@berun/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '@/test/fetch-mock';
import { RaceForm } from './race-form';

const RACE_ID = '0199f000-0000-7000-8000-00000000aa01';

function savedRace(over: Partial<AdminRace> = {}): AdminRace {
  return {
    id: RACE_ID,
    name: '테스트 하프마라톤',
    slug: 'test-half',
    organizer: null,
    regionCode: 'seoul',
    venueName: null,
    venueAddress: null,
    venuePoint: null,
    raceDate: '2027-03-15',
    registrationOpensAt: null,
    registrationOpensTimeKnown: false,
    registrationClosesAt: null,
    officialUrl: null,
    registrationUrl: null,
    courseUrl: null,
    raceType: 'road',
    registrationMethod: 'unknown',
    status: 'scheduled',
    publishStatus: 'draft',
    lastVerifiedAt: '2026-10-23T10:00:00+09:00',
    clonedFrom: null,
    events: [
      {
        id: '0199f000-0000-7000-8000-00000000ab01',
        name: '하프코스',
        category: 'half',
        distanceM: 21097,
        startTime: null,
        timeLimitMin: null,
        feeKrw: null,
        capacity: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
        registrationCount: 0,
      },
    ],
    sources: [],
    interestCount: 0,
    registrationCount: 0,
    publishMissing: [],
    createdAt: '2026-10-23T10:00:00+09:00',
    updatedAt: '2026-10-23T10:00:00+09:00',
    ...over,
  };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});
afterEach(() => vi.unstubAllGlobals());

async function fillNewRace() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('대회명'), '테스트 하프마라톤');
  await user.type(screen.getByLabelText('대회일'), '20270315');
  await user.selectOptions(screen.getByLabelText('지역'), 'seoul');
  await user.click(screen.getByRole('button', { name: '+ 하프' }));
  return user;
}

describe('A-003 대회 등록', () => {
  it('빠른 입력을 해석해 초안으로 저장한다', async () => {
    const calls = mockFetch(({ method, path }) => {
      if (path.startsWith('/races/duplicates')) return { body: [] };
      if (method === 'POST' && path === '/races')
        return { status: 201, body: { race: savedRace(), dedupeWarnings: [] } };
      return undefined;
    });
    const onSaved = vi.fn();
    render(<RaceForm race={null} role="owner" onSaved={onSaved} onSavedAndNew={vi.fn()} />);
    const user = await fillNewRace();
    await user.click(screen.getByRole('button', { name: '저장 (초안)' }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST' && c.path === '/races');
    expect(post?.body).toMatchObject({
      name: '테스트 하프마라톤',
      raceDate: '2027-03-15',
      regionCode: 'seoul',
      raceType: 'road',
      events: [{ name: '하프코스', category: 'half', distanceM: 21097 }],
    });
  });

  it('필수값이 없으면 보내지 않고 칸 옆에 표시한다', async () => {
    const calls = mockFetch(() => undefined);
    const user = userEvent.setup();
    render(<RaceForm race={null} role="owner" onSaved={vi.fn()} onSavedAndNew={vi.fn()} />);
    await user.type(screen.getByLabelText('대회일'), '2027-13-40');
    await user.click(screen.getByRole('button', { name: '저장 (초안)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('입력값을 확인해주세요');
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('게시 조건이 모자라면 422의 누락 항목을 한국어로 보여주고, 채운 뒤 게시한다', async () => {
    let publishTries = 0;
    const calls = mockFetch(({ method, path }) => {
      if (path.startsWith('/races/duplicates')) return { body: [] };
      if (method === 'POST' && path === '/races')
        return { status: 201, body: { race: savedRace(), dedupeWarnings: [] } };
      if (method === 'PUT')
        return {
          body: {
            race: savedRace(),
            dedupeWarnings: [],
            sideEffects: {
              notificationsRescheduled: false,
              sentChangeNotice: null,
              affectedUsers: 0,
            },
          },
        };
      if (method === 'POST' && path === `/races/${RACE_ID}/publish`) {
        return ++publishTries === 1
          ? {
              status: 422,
              body: apiError('PUBLISH_REQUIREMENTS_UNMET', {
                details: { missing: ['officialUrl', 'primarySourceVerified'] },
              }),
            }
          : { body: savedRace({ publishStatus: 'published', officialUrl: 'https://example.com' }) };
      }
      return undefined;
    });
    const onSaved = vi.fn();
    const first = render(
      <RaceForm race={null} role="owner" onSaved={onSaved} onSavedAndNew={vi.fn()} />,
    );
    const user = await fillNewRace();
    await user.click(screen.getByRole('button', { name: '게시' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('게시할 수 없어요');
    expect(within(alert).getByText('공식 홈페이지 URL')).toBeInTheDocument();
    expect(within(alert).getByText(/대표 출처 확인/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ publishStatus: 'draft' }));

    // 실제 화면에서는 onSaved로 수정 화면이 다시 그려진다 — 여기서는 저장된 대회로 다시 렌더
    first.unmount();
    const draft = savedRace();
    render(<RaceForm race={draft} role="owner" onSaved={onSaved} onSavedAndNew={vi.fn()} />);
    await user.type(screen.getByLabelText('공식 홈페이지 URL'), 'https://example.com');
    await user.click(screen.getByLabelText('확인 완료 — 오늘로 갱신'));
    await user.click(screen.getByRole('button', { name: '게시' }));

    await vi.waitFor(() =>
      expect(onSaved).toHaveBeenLastCalledWith(
        expect.objectContaining({ publishStatus: 'published' }),
      ),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['if-match']).toBe(draft.updatedAt);
    expect(put?.body).toMatchObject({ officialUrl: 'https://example.com', markVerifiedNow: true });
  });

  it('충돌(CONFLICT_STALE)은 새로고침 안내로 보여준다', async () => {
    mockFetch(({ method }) =>
      method === 'PUT' ? { status: 409, body: apiError('CONFLICT_STALE') } : { body: [] },
    );
    const user = userEvent.setup();
    render(<RaceForm race={savedRace()} role="owner" onSaved={vi.fn()} onSavedAndNew={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '저장 (초안)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 곳에서 먼저 수정됐어요');
  });
});
