import { describe, expect, it } from 'vitest';
import { canSendAt, isNightKst } from './kinds.js';
import { createRateLimiter } from './push.js';
import {
  BODY_MAX,
  formatDuration,
  formatPace,
  render,
  renderBundle,
  TITLE_MAX,
  type RenderInput,
} from './render.js';

const kst = (s: string) => new Date(`${s}+09:00`);
const base: RenderInput = {
  kind: 'reg_open_d1',
  race: { id: 'R', name: '2027 서울마라톤', registrationMethod: 'first_come' },
  opensAt: kst('2026-11-01T10:00:00'),
  opensTimeKnown: true,
  closesAt: kst('2026-11-15T23:59:00'),
  registrationClosed: false,
  event: { name: '하프', startAt: kst('2027-03-15T08:00:00') },
  registration: { id: 'G', goalTimeSec: 7080, goalPaceSecPerKm: 336, entryStatus: 'registered' },
};

describe('render (PRD 7.2)', () => {
  it('N-01·N-02·N-03 문구와 S-022 딥링크', () => {
    expect(render(base)).toEqual({
      title: '내일 2027 서울마라톤 접수가 시작돼요',
      body: '11월 1일 10:00 오픈이에요. 인기 대회는 빨리 마감돼요.',
      deepLink: 'berun://races/R',
    });
    expect(render({ ...base, opensTimeKnown: false }).body).toBe(
      '오픈 시각은 공식 홈페이지를 확인하세요.',
    );
    expect(render({ ...base, kind: 'reg_open_soon' })).toMatchObject({
      title: '2027 서울마라톤 접수 10분 전이에요',
      body: '10:00에 접수가 열려요. 지금 접수 페이지를 열어두세요.',
    });
    expect(
      render({
        ...base,
        kind: 'reg_open_soon',
        race: { ...base.race, registrationMethod: 'lottery' },
      }).body,
    ).toBe('10:00에 추첨 접수가 열려요. 마감 전까지만 신청하면 돼요.');
    expect(render({ ...base, kind: 'reg_open_soon', opensTimeKnown: false })).toMatchObject({
      title: '오늘 2027 서울마라톤 접수가 시작돼요',
      body: '정확한 시각은 공식 홈페이지를 확인하세요.',
    });
    expect(render({ ...base, kind: 'reg_close_d1' }).body).toBe(
      '11월 15일 23:59 마감이에요. 아직 접수 전이라면 서둘러주세요.',
    );
  });

  it('N-04: 목표 있음 → 전략, 목표 없음 → 참가 예정 수정, 접수 전 + 마감 → 상태 바꾸기 안내', () => {
    expect(render({ ...base, kind: 'race_d7' })).toEqual({
      title: '2027 서울마라톤까지 일주일 남았어요',
      body: '하프 목표 1:58:00 · 구간별 페이스를 확인해보세요.',
      deepLink: 'berun://registrations/G/strategy',
    });
    const noGoal = { ...base.registration!, goalTimeSec: null, goalPaceSecPerKm: null };
    expect(render({ ...base, kind: 'race_d7', registration: noGoal })).toMatchObject({
      body: '목표 기록을 정하고 페이스 전략을 받아보세요.',
      deepLink: 'berun://races/R/register',
    });
    expect(
      render({
        ...base,
        kind: 'race_d7',
        registrationClosed: true,
        registration: { ...base.registration!, entryStatus: 'not_registered' },
      }),
    ).toMatchObject({
      body: '아직 접수 전으로 되어 있어요. 접수했다면 접수 상태를 바꿔주세요.',
      deepLink: 'berun://races/R',
    });
  });

  it('N-05: 출발 시각·목표 페이스, 목표 없음·출발 시각 없음 변형', () => {
    expect(render({ ...base, kind: 'race_d1' })).toEqual({
      title: '내일은 2027 서울마라톤!',
      body: `08:00 출발 · 목표 페이스 5'36"/km. 푹 자고 내일 만나요.`,
      deepLink: 'berun://registrations/G/strategy',
    });
    const noGoal = { ...base.registration!, goalTimeSec: null, goalPaceSecPerKm: null };
    expect(render({ ...base, kind: 'race_d1', registration: noGoal }).body).toBe(
      '08:00 출발이에요. 즐겁게 완주하세요!',
    );
    expect(
      render({
        ...base,
        kind: 'race_d1',
        registration: noGoal,
        event: { name: '하프', startAt: null },
      }).body,
    ).toBe('즐겁게 완주하세요!');
  });

  it('N-06: "{대회명} 대회가 취소됐어요/연기됐어요" (조사 문제 없음), 일정 변경 요약', () => {
    expect(render({ ...base, kind: 'race_cancelled' }).title).toBe(
      '2027 서울마라톤 대회가 취소됐어요',
    );
    expect(
      render({ ...base, kind: 'race_postponed', race: { ...base.race, name: '부산 바다 10K' } })
        .title,
    ).toBe('부산 바다 10K 대회가 연기됐어요');
    expect(
      render({ ...base, kind: 'race_schedule_changed', changeSummary: '대회일: 3월 22일' }).body,
    ).toBe('대회일: 3월 22일. 공식 홈페이지에서 한 번 더 확인해주세요.');
  });

  it('N-07: 제보 반영·반려 (앱 내만)', () => {
    expect(render({ ...base, kind: 'report_applied' })).toMatchObject({
      title: '제보가 반영됐어요',
      body: '2027 서울마라톤 정보를 고쳤어요. 알려주셔서 감사해요.',
    });
    expect(
      render({ ...base, kind: 'report_rejected', rejectReasonText: '공식 정보와 같아요' }).body,
    ).toBe('2027 서울마라톤: 공식 정보와 같아요. 다른 점이 있으면 다시 알려주세요.');
  });

  it('길면 대회명만 줄인다: 최대 길이 = 상한 − 고정 문구 ("…" 1자 포함), N-01·N-03은 18자', () => {
    const long = '제1회 아주아주 긴 이름을 가진 국제 하프마라톤 대회 2027';
    const open = render({ ...base, race: { ...base.race, name: long } });
    expect(open.title).toBe(`내일 ${[...long].slice(0, 17).join('')}… 접수가 시작돼요`);
    expect([...open.title].length).toBe(TITLE_MAX);
    const close = render({ ...base, kind: 'reg_close_d1', race: { ...base.race, name: long } });
    expect(close.title).toBe(`${[...long].slice(0, 17).join('')}… 접수가 내일 마감돼요`);
    // 본문에 대회명이 들어가는 N-07a는 본문 상한 기준
    const applied = render({
      ...base,
      kind: 'report_applied',
      race: { ...base.race, name: long.repeat(2) },
    });
    expect([...applied.body].length).toBe(BODY_MAX);
    // 짧은 이름은 그대로, 18자 이름도 그대로
    expect(render({ ...base, kind: 'reg_close_d1' }).title).toBe(
      '2027 서울마라톤 접수가 내일 마감돼요',
    );
    const name18 = '가'.repeat(18);
    expect(render({ ...base, race: { ...base.race, name: name18 } }).title).toBe(
      `내일 ${name18} 접수가 시작돼요`,
    );
  });

  it('묶음 푸시: 제목 n개, 본문은 60자 안에서 대회명 + 외 n개, 탭하면 알림 목록', () => {
    expect(renderBundle('reg_open_d1', ['A 마라톤', 'B 하프', 'C 10K'])).toEqual({
      title: '내일 접수가 시작되는 대회 3개',
      body: 'A 마라톤, B 하프, C 10K',
      deepLink: 'berun://notifications',
    });
    expect(renderBundle('reg_open_soon', ['A', 'B']).title).toBe('10분 뒤 접수가 열리는 대회 2개');
    expect(renderBundle('reg_open_soon', ['A', 'B'], { anyOpensTimeUnknown: true }).title).toBe(
      '오늘 접수가 시작되는 대회 2개',
    );
    expect(renderBundle('race_d7', ['A', 'B']).title).toBe('일주일 뒤 열리는 대회 2개');
    const many = Array.from({ length: 8 }, (_, i) => `아주 긴 이름의 대회 ${i}`);
    const b = renderBundle('race_d1', many);
    expect([...b.body].length).toBeLessThanOrEqual(BODY_MAX);
    expect(b.body).toMatch(/외 \d+개$/);
  });
});

describe('표기·야간', () => {
  it('기록·페이스 표기 (PRD 3.2)', () => {
    expect([formatDuration(7080), formatDuration(3300), formatPace(336)]).toEqual([
      '1:58:00',
      '55:00',
      `5'36"`,
    ]);
  });
  it('야간 21:00~07:59 KST: 마케팅만 막고 서비스 알림은 보낸다 (P-NOTI-05)', () => {
    expect(
      [
        kst('2026-10-21T20:59:00'),
        kst('2026-10-21T21:00:00'),
        kst('2026-10-22T07:59:00'),
        kst('2026-10-22T08:00:00'),
      ].map(isNightKst),
    ).toEqual([false, true, true, false]);
    const night = kst('2026-10-21T23:00:00');
    expect([
      canSendAt('marketing', night),
      canSendAt('reg_close_d1', night),
      canSendAt('race_cancelled', night),
    ]).toEqual([false, true, true]);
  });
});

describe('createRateLimiter', () => {
  it('초당 한도를 넘으면 기다린다', async () => {
    let t = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter(600, {
      now: () => t,
      sleep: (ms) => {
        waits.push(ms);
        t += ms;
        return Promise.resolve();
      },
    });
    for (let i = 0; i < 6; i++) await limiter.acquire(100); // 600건: 버킷 안
    expect(waits).toEqual([]);
    await limiter.acquire(100); // 다음 100건은 1/6초 기다림
    expect(waits).toEqual([167]);
  });
});
