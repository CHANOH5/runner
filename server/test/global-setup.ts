import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import { TEST_DATABASE_URL } from './env.js';

/** 테스트 DB를 비우고 마이그레이션을 처음부터 다시 적용한다 (마이그레이션 자체도 검증) */
export default async function setup() {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
  } catch (err) {
    await sql.end();
    throw new Error(
      `테스트 DB에 연결할 수 없습니다 (${TEST_DATABASE_URL}). 먼저 'pnpm db:up'을 실행하세요.`,
      { cause: err },
    );
  }
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);
  await sql.end();
  await runMigrations(TEST_DATABASE_URL);
}
