import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../api';
import { renderScreen, type mockApiModule } from '../test/render';
import { ApiError } from '../api/client';
import { prediction, race, RACE_ID, REG_ID, registration } from '../test/fixtures';
import Home from '../app/(tabs)/home';
import Login from '../app/login';
import RaceDetailScreen from '../app/races/[raceId]/index';
import RegisterScreen from '../app/races/[raceId]/register';
import StrategyScreen from '../app/registrations/[registrationId]/strategy';
import Terms from '../app/terms';
import { useSession } from '../stores/session';

jest.mock('../api', () => require('../test/render').mockApiModule());

const mocked = api as unknown as ReturnType<typeof mockApiModule>['api'];
const params = useLocalSearchParams as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mocked))
    fn.mockReset().mockImplementation(() => new Promise(() => undefined));
});

describe('S-002 로그인', () => {
  it('개발 전용 로그인: dev:{이름} 토큰으로 요청하고 신규면 약관으로', async () => {
    mocked.socialLogin!.mockResolvedValue({
      result: 'signup_required',
      signupToken: 't',
      signupTokenExpiresAt: '2026-10-23T13:00:00+09:00',
      emailProvided: false,
    });
    const user = userEvent.setup();
    await renderScreen(<Login />);
    expect(screen.getByText('대회를 찾고, 목표를 세우고, 함께 달려요')).toBeOnTheScreen();
    // iOS(테스트 기본 플랫폼): 카카오 → Apple → Google
    expect(screen.getByRole('button', { name: 'Apple로 계속하기' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: '개발 계정으로 로그인' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/terms'));
    expect(mocked.socialLogin).toHaveBeenCalledWith({
      provider: 'kakao',
      accessToken: 'dev:runner1',
    });
    expect(useSession.getState().signup?.token).toBe('t');
  });
});

describe('S-003 약관 동의', () => {
  it('필수 2개가 체크돼야 [다음]이 활성, 전체 동의는 선택까지', async () => {
    useSession
      .getState()
      .setSignup({ token: 't', expiresAt: '', agreedTermIds: [], marketing: false });
    const term = (id: string, kind: string, required: boolean) => ({
      id,
      kind,
      version: 'v1',
      required,
      contentUrl: 'https://example.test',
      effectiveAt: '2026-01-01T00:00:00+09:00',
    });
    mocked.terms!.mockResolvedValue([
      term('0199f000-0000-7000-8000-000000000401', 'service', true),
      term('0199f000-0000-7000-8000-000000000402', 'privacy', true),
      term('0199f000-0000-7000-8000-000000000403', 'marketing', false),
    ]);
    const user = userEvent.setup();
    await renderScreen(<Terms />);
    const next = screen.getByRole('button', { name: '다음' });
    await user.press(await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' }));
    expect(next).toBeDisabled();
    await user.press(screen.getByRole('checkbox', { name: '[필수] 개인정보 수집·이용 동의' }));
    expect(next).toBeEnabled();
    await user.press(screen.getByRole('checkbox', { name: '전체 동의' }));
    expect(screen.getByTestId('terms-marketing')).toBeChecked();
    await user.press(next);
    expect(router.push).toHaveBeenCalledWith('/profile-setup');
    expect(useSession.getState().signup?.marketing).toBe(true);
  });
});

describe('S-010 홈', () => {
  it('참가 예정 없음 + 기록 없음 → 빈 상태와 기록 유도 카드, 비어 있는 섹션은 숨김', async () => {
    mocked.nextRace!.mockResolvedValue({ next: null, moreCount: 0, hasAnyRecord: false });
    mocked.deadlines!.mockResolvedValue({ items: [] });
    mocked.recommended!.mockResolvedValue({
      regionCode: 'seoul',
      items: [],
      filledNationwide: false,
    });
    mocked.unreadCount!.mockResolvedValue({ count: 120 });
    await renderScreen(<Home />);
    expect(await screen.findByText('아직 참가 예정인 대회가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('기록을 넣으면 예상 기록을 알려드려요')).toBeOnTheScreen();
    expect(await screen.findByText('99+')).toBeOnTheScreen();
    expect(screen.queryByText('접수 임박')).not.toBeOnTheScreen();
  });

  it('섹션 하나가 실패해도 다른 섹션은 보인다', async () => {
    mocked.nextRace!.mockRejectedValue(new Error('x'));
    mocked.deadlines!.mockResolvedValue({ items: [] });
    mocked.recommended!.mockResolvedValue({
      regionCode: 'seoul',
      items: [{ ...race(), my: { interested: false, registered: false } }],
      filledNationwide: false,
    });
    mocked.unreadCount!.mockResolvedValue({ count: 0 });
    await renderScreen(<Home />);
    expect(await screen.findByText('불러오지 못했어요')).toBeOnTheScreen();
    expect(await screen.findByText('서울 근처 대회')).toBeOnTheScreen();
  });
});

describe('S-022 대회 상세', () => {
  beforeEach(() => params.mockReturnValue({ raceId: RACE_ID }));

  it('출처·최종 확인일·변경 안내는 항상, 지도는 자리 표시', async () => {
    mocked.race!.mockResolvedValue(race());
    await renderScreen(<RaceDetailScreen />);
    expect(await screen.findByText('출처: 공식 홈페이지 · 최종 확인 2026.10.15')).toBeOnTheScreen();
    expect(
      screen.getByText('대회 정보는 변경될 수 있어요. 정확한 정보는 공식 홈페이지를 확인하세요.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('map-placeholder')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '참가 예정 추가' })).toBeEnabled();
  });

  it('취소 대회: 안내 + [참가 예정 추가] 비활성', async () => {
    mocked.race!.mockResolvedValue(race({ status: 'cancelled', registrationState: 'cancelled' }));
    await renderScreen(<RaceDetailScreen />);
    expect(await screen.findByText('이 대회는 취소되었어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '참가 예정 추가' })).toBeDisabled();
  });

  it('참가 예정 접수 전 + 접수 중 → 내 참가 예정 카드와 마감 안내', async () => {
    const reg = registration();
    mocked.race!.mockResolvedValue(
      race({
        my: {
          interested: true,
          registration: {
            id: reg.id,
            raceEventId: reg.raceEventId,
            eventName: reg.eventName,
            eventDistanceM: reg.eventDistanceM,
            predictionSupported: true,
            goalTimeSec: 7080,
            goalPaceSecPerKm: 336,
            entryStatus: 'not_registered',
            entryStatusUpdatedAt: null,
          },
        },
      }),
    );
    await renderScreen(<RaceDetailScreen />);
    expect(await screen.findByText('하프코스 · 목표 1:58:00')).toBeOnTheScreen();
    expect(screen.getByText(/아직 접수 전이에요 · 마감 8\.31 \(월\) 23:59/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '참가 예정 · 하프코스' })).toBeOnTheScreen();
  });

  it('숨김 대회(410) → 더 이상 볼 수 없는 대회예요', async () => {
    mocked.race!.mockRejectedValue(new ApiError(410, 'RACE_UNAVAILABLE'));
    await renderScreen(<RaceDetailScreen />);
    expect(await screen.findByText('더 이상 볼 수 없는 대회예요')).toBeOnTheScreen();
  });
});

describe('S-023 참가 예정 추가', () => {
  it('접수 중 대회는 접수 전이 기본, 접수 완료로 바꿔 추가하면 entryStatus를 보낸다', async () => {
    params.mockReturnValue({ raceId: RACE_ID });
    mocked.race!.mockResolvedValue(race());
    mocked.previewPrediction!.mockResolvedValue(prediction({ id: null, createdAt: null }));
    mocked.createRegistration!.mockResolvedValue(
      registration({ goalTimeSec: null, goalSource: 'none' }),
    );
    const user = userEvent.setup();
    await renderScreen(<RegisterScreen />);
    expect(await screen.findByText('참가 예정 추가')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-segment-not_registered')).toBeSelected();
    await user.press(screen.getByRole('radio', { name: /하프코스/ }));
    expect(await screen.findByText('2:03:22')).toBeOnTheScreen();
    await user.press(screen.getByTestId('entry-segment-registered'));
    await user.press(screen.getByRole('button', { name: '추가하기' }));
    await waitFor(() =>
      expect(mocked.createRegistration).toHaveBeenCalledWith(RACE_ID, {
        raceEventId: '0199f000-0000-7000-8000-000000000202',
        entryStatus: 'registered',
        entryStatusSource: 'form',
        goalSource: 'none',
      }),
    );
  });

  it('접수 마감 대회는 접수 완료가 기본, 복귀 질문에서 오면 제목이 바뀐다', async () => {
    params.mockReturnValue({ raceId: RACE_ID, from: 'return_prompt' });
    mocked.race!.mockResolvedValue(race({ registrationState: 'closed' }));
    await renderScreen(<RegisterScreen />);
    expect(await screen.findByText('어느 종목에 접수했나요?')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-segment-registered')).toBeSelected();
  });
});

describe('S-033 페이스 전략 (참가 예정 기준)', () => {
  beforeEach(() => {
    params.mockReturnValue({ registrationId: REG_ID });
    mocked.registration!.mockResolvedValue(registration());
    mocked.race!.mockResolvedValue(race());
  });

  it('예측 결과: 면책 문구·신뢰도 사유·기준 토글·통과 시각', async () => {
    mocked.strategy!.mockResolvedValue({
      prediction: prediction({ recordsChangedSince: true }),
      predictionUnavailableReason: null,
      goalSplits: prediction().splits,
    });
    await renderScreen(<StrategyScreen />);
    expect(await screen.findByTestId('disclaimer')).toHaveTextContent(/통계적 추정이며/);
    expect(
      screen.getByText('목표 거리와 비슷한 최근 기록이 여러 개 있어 비교적 믿을 만해요.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('기록이 바뀌었어요 · 다시 예측')).toBeOnTheScreen();
    expect(screen.getByTestId('split-basis')).toBeOnTheScreen();
    expect(screen.getAllByText('08:29').length).toBeGreaterThan(0);
  });

  it('예측 없음 + 목표 있음: 목표 기준 스플릿만, 면책·토글 없음', async () => {
    mocked.strategy!.mockResolvedValue({
      prediction: null,
      predictionUnavailableReason: 'no_records',
      goalSplits: prediction().splits,
    });
    await renderScreen(<StrategyScreen />);
    expect(await screen.findByText('기록을 넣으면 예상 기록도 볼 수 있어요')).toBeOnTheScreen();
    expect(screen.getByTestId('split-table')).toBeOnTheScreen();
    expect(screen.queryByTestId('disclaimer')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('split-basis')).not.toBeOnTheScreen();
  });

  it('예측·목표 모두 없음: 빈 상태', async () => {
    mocked.registration!.mockResolvedValue(registration({ goalTimeSec: null, goalSource: 'none' }));
    mocked.strategy!.mockResolvedValue({
      prediction: null,
      predictionUnavailableReason: 'no_records',
      goalSplits: null,
    });
    await renderScreen(<StrategyScreen />);
    expect(
      await screen.findByText('목표 기록이나 최근 기록이 있어야 페이스 전략을 만들 수 있어요'),
    ).toBeOnTheScreen();
  });
});
