import {
  EMPTY_RECORD,
  loadPromptRecord,
  recordDismissal,
  recordSettled,
  savePromptDismissed,
  savePromptSettled,
  shouldAskReturnPrompt,
} from './returnPrompt';

/** 복귀 질문 규칙 (PRD 4.10.1 수용 기준) */
const T0 = Date.parse('2026-10-23T10:00:00+09:00');
const base = {
  openedAt: T0,
  returnedAt: T0 + 15_000,
  registrationState: 'open' as const,
  entryStatus: 'not_registered' as const,
  record: EMPTY_RECORD,
};

describe('shouldAskReturnPrompt', () => {
  it('참가 예정 접수 전 + 접수 중 + 15초 후 돌아옴 → 묻는다', () => {
    expect(shouldAskReturnPrompt(base)).toBe(true);
  });

  it('5초 만에 돌아오면 묻지 않는다 (10초 미만)', () => {
    expect(shouldAskReturnPrompt({ ...base, returnedAt: T0 + 5_000 })).toBe(false);
    expect(shouldAskReturnPrompt({ ...base, returnedAt: T0 + 10_000 })).toBe(true);
  });

  it('접수 중·접수 일정 미정일 때만', () => {
    expect(shouldAskReturnPrompt({ ...base, registrationState: 'unscheduled' })).toBe(true);
    for (const s of ['upcoming', 'closed', 'ended', 'cancelled'] as const) {
      expect(shouldAskReturnPrompt({ ...base, registrationState: s })).toBe(false);
    }
  });

  it('참가 예정이 없으면 묻고, 접수 완료·접수 못 함이면 묻지 않는다', () => {
    expect(shouldAskReturnPrompt({ ...base, entryStatus: null })).toBe(true);
    expect(shouldAskReturnPrompt({ ...base, entryStatus: 'registered' })).toBe(false);
    expect(shouldAskReturnPrompt({ ...base, entryStatus: 'missed' })).toBe(false);
  });

  it('[아직이에요] 3시간 뒤에는 묻지 않고, 24시간이 지나면 다시 묻는다', () => {
    const record = recordDismissal(EMPTY_RECORD, T0);
    const at = (h: number) => ({
      ...base,
      openedAt: T0 + h * 3600_000,
      returnedAt: T0 + h * 3600_000 + 15_000,
      record,
    });
    expect(shouldAskReturnPrompt(at(3))).toBe(false);
    expect(shouldAskReturnPrompt(at(25))).toBe(true);
  });

  it('[아직이에요]·무시가 누적 3회면 더 묻지 않는다', () => {
    let record = EMPTY_RECORD;
    for (let i = 0; i < 3; i++) record = recordDismissal(record, T0 - (i + 2) * 86400_000);
    expect(record.dismissCount).toBe(3);
    expect(shouldAskReturnPrompt({ ...base, record })).toBe(false);
  });

  it('[접수 완료했어요]·직접 변경 이후에는 묻지 않는다', () => {
    expect(shouldAskReturnPrompt({ ...base, record: recordSettled(EMPTY_RECORD) })).toBe(false);
  });
});

describe('기기 저장', () => {
  it('대회별로 무시 횟수·완료를 저장한다', async () => {
    await savePromptDismissed('race-a', T0);
    await savePromptDismissed('race-a', T0 + 1);
    await savePromptSettled('race-b');
    expect(await loadPromptRecord('race-a')).toEqual({
      dismissCount: 2,
      lastDismissedAt: T0 + 1,
      settled: false,
    });
    expect((await loadPromptRecord('race-b')).settled).toBe(true);
    expect(await loadPromptRecord('race-c')).toEqual(EMPTY_RECORD);
  });
});
