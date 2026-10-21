/** 시드의 개발 사용자로 access token을 발급한다 (로컬 전용). 사용: pnpm --filter @berun/server dev:token */
import { importPKCS8 } from 'jose';
import { uuidv7 } from 'uuidv7';
import { SEED_IDS } from '../src/db/seed.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';

const pem = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!pem) {
  console.error(
    'JWT_PRIVATE_KEY가 없습니다. pnpm --filter @berun/server dev:keys 로 만들어 .env에 넣으세요.',
  );
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('운영 환경에서는 쓰지 않습니다.');
  process.exit(1);
}

const key = await importPKCS8(pem, 'ES256');
const token = await signAccessToken(
  key,
  { userId: SEED_IDS.devUser, sessionId: uuidv7() },
  { expiresIn: '12h' },
);
process.stdout.write(`${token}\n`);
