/** 개발용 관리자(시드)의 현재 TOTP 코드 (로컬 전용). 사용: pnpm --filter @berun/server dev:admin-totp */
import { DEV_ADMIN } from '../src/db/seed.js';
import { totpCode } from '../src/modules/admin/totp.js';

process.stdout.write(`${totpCode(DEV_ADMIN.totpSecret, new Date())}\n`);
