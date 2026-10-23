import { ApiError } from './client';
import { errorMessage, saveErrorMessage, screenErrorMessage } from './messages';

describe('에러 코드 → 한국어 문구 (tech/06 3.2)', () => {
  it('한도 초과는 resource별 문구', () => {
    const e = (resource: string) => new ApiError(422, 'LIMIT_EXCEEDED', { resource });
    expect(errorMessage(e('interests'))).toBe(
      '관심 대회는 200개까지 저장할 수 있어요. 지난 대회를 정리해주세요',
    );
    expect(errorMessage(e('registrations'))).toBe('참가 예정 대회는 30개까지 추가할 수 있어요');
    expect(errorMessage(e('records'))).toBe('기록은 500개까지 저장할 수 있어요');
  });

  it('닉네임 변경 제한은 날짜를 넣는다', () => {
    const e = new ApiError(422, 'NICKNAME_CHANGE_COOLDOWN', {
      availableAt: '2026-10-30T00:00:00+09:00',
    });
    expect(errorMessage(e)).toBe('10월 30일부터 바꿀 수 있어요');
  });

  it('저장 중 네트워크 오류·화면 오류·알 수 없는 코드', () => {
    expect(saveErrorMessage(new ApiError(0, 'NETWORK'))).toBe(
      '저장하지 못했어요. 다시 시도해주세요',
    );
    expect(screenErrorMessage(new ApiError(404, 'NOT_FOUND'))).toBe(
      '삭제되었거나 찾을 수 없는 정보예요',
    );
    expect(errorMessage(new ApiError(500, 'SOMETHING_NEW'))).toBe('잠시 문제가 생겼어요');
    expect(errorMessage(new ApiError(429, 'REPORT_LIMIT_DAILY'))).toBe(
      '오늘은 더 제보할 수 없어요. 내일 다시 시도해주세요',
    );
  });
});
