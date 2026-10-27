import type { MyRaceItem } from '@berun/shared';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../api';
import { AppConfig } from '@berun/shared';
import MyRaces from '../app/my/races';
import Home from '../app/(tabs)/home';
import Terms from '../app/terms';
import { DateField } from '../components/DateField';
import { DateField as WebDateField } from '../components/DateField.web';
import { ToastHost } from '../components/ui';
import { openInAppBrowser } from '../lib/external';
import { useSession } from '../stores/session';
import { useToast } from '../stores/toast';
import { race } from '../test/fixtures';
import { renderScreen, type mockApiModule } from '../test/render';

jest.mock('../api', () => require('../test/render').mockApiModule());
jest.mock('../lib/external', () => ({
  openInAppBrowser: jest.fn(),
  useExternalLinkReturn: () => jest.fn(),
}));
// 네이티브 달력 피커: 받은 props를 그대로 노출하는 대체
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: object) => <View {...props} /> };
});

const mocked = api as unknown as ReturnType<typeof mockApiModule>['api'];

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mocked))
    fn.mockReset().mockImplementation(() => new Promise(() => undefined));
});

const summary = (id: string, over: Partial<MyRaceItem> = {}): MyRaceItem => {
  const {
    events,
    venue,
    organizer,
    earliestStartAt,
    officialUrl,
    registrationUrl,
    courseUrl,
    source,
    lastVerifiedAt,
    my,
    ...rest
  } = race();
  void events;
  void venue;
  void organizer;
  void earliestStartAt;
  void officialUrl;
  void registrationUrl;
  void courseUrl;
  void source;
  void lastVerifiedAt;
  void my;
  return {
    ...rest,
    id,
    name: `대회 ${id}`,
    my: { interested: true, registered: false },
    registration: null,
    unavailable: false,
    ...over,
  };
};

describe('S-010 추천 대회 — 전국 보충', () => {
  it('"추천 대회" 제목과 안내 줄', async () => {
    mocked.nextRace!.mockResolvedValue({ next: null, moreCount: 0, hasAnyRecord: true });
    mocked.deadlines!.mockResolvedValue({ items: [] });
    mocked.unreadCount!.mockResolvedValue({ count: 0 });
    mocked.recommended!.mockResolvedValue({
      regionCode: 'seoul',
      items: [{ ...race(), regionCode: 'busan', my: { interested: false, registered: false } }],
      filledNationwide: true,
    });
    await renderScreen(<Home />);
    expect(await screen.findByText('추천 대회')).toBeOnTheScreen();
    expect(screen.getByTestId('recommended-note')).toHaveTextContent(
      '서울 대회가 적어 전국 대회도 함께 보여드려요',
    );
    expect(screen.queryByText('서울 근처 대회')).not.toBeOnTheScreen();
  });
});

describe('S-061 관심 해제 + [되돌리기]', () => {
  beforeEach(() => (useLocalSearchParams as jest.Mock).mockReturnValue({ tab: 'interested' }));

  it('하트를 끄면 카드가 빠지고, [되돌리기]를 누르면 다시 PUT', async () => {
    mocked.myRaces!.mockResolvedValue({ items: [summary('r1'), summary('r2')], nextCursor: null });
    mocked.interestOff!.mockResolvedValue({ interested: false, stillRegistered: false });
    mocked.interestOn!.mockResolvedValue({ interested: true, notifyRegistrationOpen: false });
    const user = userEvent.setup();
    await renderScreen(
      <>
        <MyRaces />
        <ToastHost />
      </>,
    );
    expect(await screen.findByText('대회 r1')).toBeOnTheScreen();
    await user.press(screen.getByTestId('heart-r1'));
    await waitFor(() => expect(screen.queryByText('대회 r1')).not.toBeOnTheScreen());
    expect(screen.getByText('대회 r2')).toBeOnTheScreen();
    expect(screen.getByTestId('toast')).toHaveTextContent('관심 대회에서 뺐어요');
    expect(useToast.getState().duration).toBe(5000);
    await user.press(screen.getByTestId('toast-action'));
    await waitFor(() => expect(mocked.interestOn).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('대회 r1')).toBeOnTheScreen();
  });

  it('참가 예정인 대회는 확인 다이얼로그를 먼저 띄운다', async () => {
    mocked.myRaces!.mockResolvedValue({
      items: [summary('r1', { my: { interested: true, registered: true } })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    await renderScreen(<MyRaces />);
    await user.press(await screen.findByTestId('heart-r1'));
    expect(
      await screen.findByText('참가 예정인 대회예요. 관심을 해제해도 참가 예정은 유지돼요.'),
    ).toBeOnTheScreen();
    expect(mocked.interestOff).not.toHaveBeenCalled();
  });
});

describe('처리방침 주소 (S-003, PRD v1.11 4.2)', () => {
  const term = (id: string, kind: string, required: boolean) => ({
    id,
    kind,
    version: 'v1',
    required,
    contentUrl: `https://example.test/${kind}`,
    effectiveAt: '2026-01-01T00:00:00+09:00',
  });
  const terms = [
    term('0199f000-0000-7000-8000-000000000401', 'service', true),
    term('0199f000-0000-7000-8000-000000000402', 'privacy', true),
  ];
  const cfg = {
    minNativeVersion: { ios: '1.0.0', android: '1.0.0' },
    maintenance: { active: false, until: null },
    supportEmail: null,
    privacyPolicyUrl: null,
  };

  beforeEach(() =>
    useSession
      .getState()
      .setSignup({ token: 't', expiresAt: '', agreedTermIds: [], marketing: false }),
  );

  it('privacyPolicyUrl이 있으면 그 주소를 연다', async () => {
    mocked.terms!.mockResolvedValue(terms);
    mocked.appConfig!.mockResolvedValue(
      AppConfig.parse({ ...cfg, privacyPolicyUrl: 'https://policy.test/privacy' }),
    );
    const user = userEvent.setup();
    await renderScreen(<Terms />);
    await user.press(await screen.findByText('개인정보 처리방침 보기'));
    await waitFor(() =>
      expect(openInAppBrowser).toHaveBeenLastCalledWith('https://policy.test/privacy'),
    );
  });

  it('null이면(개발 환경) 개인정보 수집·이용 동의 전문', async () => {
    mocked.terms!.mockResolvedValue(terms);
    mocked.appConfig!.mockResolvedValue(AppConfig.parse(cfg));
    const user = userEvent.setup();
    await renderScreen(<Terms />);
    await user.press(await screen.findByText('개인정보 처리방침 보기'));
    expect(openInAppBrowser).toHaveBeenLastCalledWith('https://example.test/privacy');
  });

  it('공유 app-config 스키마: privacyPolicyUrl은 http(s) 주소 또는 null', () => {
    expect(AppConfig.parse(cfg).privacyPolicyUrl).toBeNull();
    expect(AppConfig.safeParse({ ...cfg, privacyPolicyUrl: 'not a url' }).success).toBe(false);
  });
});

describe('S-005·S-031 날짜 — 네이티브 달력 피커 (PRD v1.11 4.4)', () => {
  it('직접 입력 없이 달력(오늘까지만, 1990-01-01부터) + [오늘]·[어제]', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await renderScreen(
      <DateField value="2026-10-11" onChange={onChange} today="2026-10-27" testID="d" />,
    );
    expect(screen.queryByPlaceholderText('YYYY-MM-DD')).not.toBeOnTheScreen();
    expect(screen.getByText('2026.10.11 (일)')).toBeOnTheScreen();
    await user.press(screen.getByTestId('d'));
    const picker = await screen.findByTestId('d-picker');
    expect(picker.props.maximumDate).toEqual(new Date(2026, 9, 27));
    expect(picker.props.minimumDate).toEqual(new Date(1990, 0, 1));
    expect(picker.props.mode).toBe('date');
    await act(async () => {
      picker.props.onChange({ type: 'set' }, new Date(2026, 9, 20));
    });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-20');
    await user.press(screen.getByText('어제'));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-26');
    await user.press(screen.getByText('오늘'));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-27');
  });

  it('웹 미리보기 빌드는 직접 입력 (DateField.web)', async () => {
    const onChange = jest.fn();
    await renderScreen(<WebDateField value="" onChange={onChange} today="2026-10-27" testID="w" />);
    await fireEvent.changeText(screen.getByPlaceholderText('YYYY-MM-DD'), '2026-10-01');
    expect(onChange).toHaveBeenCalledWith('2026-10-01');
    expect(screen.getByText('오늘')).toBeOnTheScreen();
  });
});
