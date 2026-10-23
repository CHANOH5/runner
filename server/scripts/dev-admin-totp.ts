/**
 * 개발용 관리자(시드)의 현재 TOTP 코드 (로컬 전용). 사용: pnpm dev:admin-totp
 * 시드 비밀키는 개발 전용 고정값이라 NODE_ENV=production이면 실행하지 않는다.
 */
import { assertNotProduction, DEV_ADMIN } from '../src/db/seed.js';
import { totpCode } from '../src/modules/admin/totp.js';

assertNotProduction('dev:admin-totp');
const now = new Date();
const left = 30 - (Math.floor(now.getTime() / 1000) % 30);
process.stdout.write(`${totpCode(DEV_ADMIN.totpSecret, now)}\n`);
process.stderr.write(`(${DEV_ADMIN.email} · ${left}초 동안 유효)\n`);
