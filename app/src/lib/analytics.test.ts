import {
  createAnalytics,
  sanitizeProps,
  userIdFromAccessToken,
  type AnalyticsEvents,
} from './analytics';

/** 분석 (D-017, P-PRI-08): 키 없으면 no-op, 이메일·닉네임·좌표는 절대 나가지 않는다 */

function setup(apiKey: string | undefined = 'phc_test') {
  const sent: {
    url: string;
    body: { event: string; distinct_id: string; properties: Record<string, unknown> };
  }[] = [];
  const a = createAnalytics({
    apiKey,
    host: 'https://posthog.test/',
    fetch: ((url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch,
    context: () => ({ app_version: '1.0.0', platform: 'ios' }),
    anonymousId: () => 'anon-1',
    now: () => new Date('2026-10-27T01:00:00Z'),
  });
  return { a, sent };
}

describe('createAnalytics', () => {
  it('키가 없으면 아무것도 보내지 않는다', () => {
    const { a, sent } = setup('');
    a.track('race_list_viewed', { view: 'list', filter_count: 0 });
    expect(a.enabled).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('PostHog capture API로 내부 user_id만 식별자로 보낸다', () => {
    const { a, sent } = setup();
    a.track('login_started', { provider: 'kakao', dev: false });
    a.identify('0199f000-0000-7000-8000-000000000001');
    a.track('interest_toggled', { race_id: 'r1', on: true, source: 'card' });
    a.reset();
    a.track('race_list_viewed', { view: 'calendar', filter_count: 2 });
    expect(sent.map((s) => s.url)).toEqual(Array(3).fill('https://posthog.test/capture/'));
    expect(sent.map((s) => s.body.distinct_id)).toEqual([
      'anon-1',
      '0199f000-0000-7000-8000-000000000001',
      'anon-1',
    ]);
    expect(sent[1]!.body.properties).toEqual({
      app_version: '1.0.0',
      platform: 'ios',
      race_id: 'r1',
      on: true,
      source: 'card',
      $lib: 'berun-app',
    });
  });

  it('실수로 개인정보를 넘겨도 걸러낸다 (이메일·닉네임·좌표·주소)', () => {
    const { a, sent } = setup();
    const leaky = {
      race_id: 'r1',
      source: 'card',
      on: true,
      email: 'runner@example.com',
      nickname: '러너',
      userNickname: '러너',
      venue_lat: 37.52,
      lng: 126.93,
      latitude: 37.5,
      venueAddress: '서울 영등포구 여의동로 330',
      name: '홍길동',
      note: 'contact runner@example.com',
      where: '37.5284, 126.9327',
      nested: { email: 'x@y.z' },
    } as unknown as AnalyticsEvents['interest_toggled'];
    a.track('interest_toggled', leaky);
    const props = sent[0]!.body.properties;
    expect(Object.keys(props).sort()).toEqual(
      ['$lib', 'app_version', 'on', 'platform', 'race_id', 'source'].sort(),
    );
    expect(JSON.stringify(sent[0]!.body)).not.toMatch(
      /@example\.com|러너|홍길동|37\.52|126\.93|여의동로/,
    );
  });
});

describe('sanitizeProps', () => {
  it('플랫폼·기간 같은 정상 키는 남긴다 (단어 단위 판정)', () => {
    expect(
      sanitizeProps({
        platform: 'ios',
        duration_sec: 30,
        registration_state: 'open',
        region_code: 'seoul',
      }),
    ).toEqual({
      platform: 'ios',
      duration_sec: 30,
      registration_state: 'open',
      region_code: 'seoul',
    });
  });
});

describe('userIdFromAccessToken', () => {
  it('JWT sub를 읽는다, 형식이 틀리면 null', () => {
    const payload = btoa(JSON.stringify({ sub: 'user-1', sid: 's' })).replace(/=+$/, '');
    expect(userIdFromAccessToken(`h.${payload}.sig`)).toBe('user-1');
    expect(userIdFromAccessToken('garbage')).toBeNull();
  });
});
