import type { FieldError } from '@berun/shared';

/** fastify-type-provider-zod의 검증 에러 항목 (Zod issue를 Ajv 형태로 감싼 것) */
export type ValidationItem = {
  keyword: string;
  instancePath: string;
  message?: string;
  params: Record<string, unknown>;
};

/** "/events/2/distanceM" → "events[2].distanceM" */
export function toFieldPath(instancePath: string): string {
  return instancePath
    .split('/')
    .filter(Boolean)
    .reduce((acc, seg) => (/^\d+$/.test(seg) ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), '');
}

function toFieldCode(item: ValidationItem): string {
  const origin = item.params.origin;
  switch (item.keyword) {
    case 'invalid_type':
      return item.message?.endsWith('received undefined') ? 'required' : 'invalid_type';
    case 'too_small':
      return origin === 'string' ? 'too_short' : origin === 'array' ? 'too_few' : 'out_of_range';
    case 'too_big':
      return origin === 'string' ? 'too_long' : origin === 'array' ? 'too_many' : 'out_of_range';
    case 'invalid_format':
      return 'invalid_format';
    case 'invalid_value':
    case 'invalid_union':
      return 'invalid_value';
    case 'unrecognized_keys':
      return 'unknown_field';
    case 'custom': {
      const params = item.params.params as { code?: unknown } | undefined;
      return typeof params?.code === 'string' ? params.code : 'invalid';
    }
    default:
      return 'invalid';
  }
}

export function toFieldErrors(items: ValidationItem[], prefix?: string): FieldError[] {
  return items.map((item) => {
    const path = toFieldPath(item.instancePath);
    return {
      path: prefix && !path ? prefix : path,
      code: toFieldCode(item),
    };
  });
}
