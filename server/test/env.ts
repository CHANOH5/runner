/** 통합 테스트는 docker compose의 테스트 DB(berun_test)와 Redis DB 1번을 쓴다 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://berun:berun@localhost:55432/berun_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1';
