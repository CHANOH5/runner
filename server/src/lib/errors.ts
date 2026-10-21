import { ERROR_HTTP_STATUS, type ErrorCode, type FieldError } from '@berun/shared';

/**
 * 서비스·라우트에서 던지는 에러. 에러 핸들러가 tech/06 3.1 형식으로 바꾼다.
 * message는 개발자용 영문 설명 (앱에 표시하지 않음).
 */
export class AppError extends Error {
  override name = 'AppError';
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;
  readonly fieldErrors: FieldError[] | undefined;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; fieldErrors?: FieldError[] } = {},
  ) {
    super(message);
    this.statusCode = ERROR_HTTP_STATUS[code];
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
  }
}

export const notFound = (what = 'resource') => new AppError('NOT_FOUND', `${what} not found`);

export const validationFailed = (fieldErrors: FieldError[]) =>
  new AppError('VALIDATION_FAILED', 'request validation failed', { fieldErrors });
