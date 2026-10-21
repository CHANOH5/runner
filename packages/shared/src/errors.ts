import { z } from 'zod';

/** 에러 코드 (tech/06 3.2). 앱은 code로 분기하고 message는 표시하지 않는다. */
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  REFRESH_INVALID: 401,
  REFRESH_REUSED: 401,
  SIGNUP_TOKEN_EXPIRED: 401,
  SOCIAL_TOKEN_INVALID: 401,
  ACCOUNT_SUSPENDED: 403,
  TERMS_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOTICE_WITHDRAWN: 410,
  RACE_UNAVAILABLE: 410,
  ALREADY_REGISTERED: 409,
  RACE_CANCELLED: 409,
  RACE_FINISHED: 409,
  DUPLICATE_RECORD: 409,
  NICKNAME_TAKEN: 409,
  CONFLICT_STALE: 409,
  NICKNAME_FORBIDDEN: 422,
  NICKNAME_CHANGE_COOLDOWN: 422,
  UNDERAGE: 422,
  LIMIT_EXCEEDED: 422,
  TARGET_DISTANCE_UNSUPPORTED: 422,
  NO_ELIGIBLE_RECORDS: 422,
  GOAL_OUT_OF_RANGE: 422,
  PUBLISH_REQUIREMENTS_UNMET: 422,
  RATE_LIMITED: 429,
  REPORT_LIMIT_DAILY: 429,
  UPGRADE_REQUIRED: 426,
  INTERNAL: 500,
  MAINTENANCE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;
export const ErrorCode = z.enum(Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const FieldError = z.object({
  /** "goalTimeSec", "events[2].distanceM" */
  path: z.string(),
  /** "required" | "too_short" | "too_long" | "out_of_range" | "invalid_format" | "invalid_value" | ... */
  code: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    fieldErrors: z.array(FieldError).optional(),
  }),
  /** 응답 헤더 X-Request-Id와 같다 */
  requestId: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;
