import type { ApiError } from '@berun/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import { toFieldErrors, type ValidationItem } from '../lib/validation.js';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  error: ApiError['error'],
) {
  const body: ApiError = { error, requestId: request.id };
  return reply.status(status).send(body);
}

/** 모든 에러를 tech/06 3장 형식 `{ error: { code, message, ... }, requestId }`으로 응답한다. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) request.log.error({ err }, err.message);
      return send(reply, request, err.statusCode, {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
        ...(err.fieldErrors && { fieldErrors: err.fieldErrors }),
      });
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(reply, request, 400, {
        code: 'VALIDATION_FAILED',
        message: `${err.validationContext ?? 'request'} validation failed`,
        details: { in: err.validationContext },
        fieldErrors: toFieldErrors(err.validation as ValidationItem[]),
      });
    }

    if (isResponseSerializationError(err)) {
      // 응답이 명세와 다르다 = 서버 버그. 내용은 로그에만 남긴다.
      request.log.error({ err, issues: err.cause.issues }, 'response serialization failed');
      return send(reply, request, 500, { code: 'INTERNAL', message: 'internal server error' });
    }

    // Fastify 자체 4xx (잘못된 JSON, 본문 크기 초과, 지원하지 않는 Content-Type 등)
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return send(reply, request, 400, {
        code: 'VALIDATION_FAILED',
        message: err.message,
        details: { reason: err.code },
      });
    }

    request.log.error({ err }, 'unhandled error');
    return send(reply, request, 500, { code: 'INTERNAL', message: 'internal server error' });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, {
      code: 'NOT_FOUND',
      message: `route ${request.method} ${request.url} not found`,
    }),
  );
}
