import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    // 서버 계산은 KST 기준이지만 DB 세션은 UTC로 두고 변환은 애플리케이션에서 한다
    connection: { TimeZone: 'UTC' },
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>['db'];
