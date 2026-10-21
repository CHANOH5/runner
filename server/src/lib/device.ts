import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DeviceInfo } from '../modules/auth/tokens.js';
import { validationFailed } from './errors.js';

/** 공통 요청 헤더 X-Device-Id(uuid)·X-Platform (tech/06 1장). 없으면 null */
export function deviceFrom(request: FastifyRequest): DeviceInfo {
  const id = request.headers['x-device-id'];
  const platform = request.headers['x-platform'];
  if (id !== undefined && (typeof id !== 'string' || !z.uuid().safeParse(id).success)) {
    throw validationFailed([{ path: 'x-device-id', code: 'invalid_format' }]);
  }
  return {
    deviceId: id ?? null,
    platform: platform === 'ios' || platform === 'android' ? platform : null,
  };
}
