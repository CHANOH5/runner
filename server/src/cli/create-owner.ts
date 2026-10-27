/**
 * 운영 첫 owner 관리자 만들기 — 일회성 (T-029, tech/07 "첫 owner 만들기").
 *   로컬: pnpm --filter @berun/server admin:create-owner -- --email owner@example.com
 *   운영: (ECS Exec로 API 컨테이너 안에서) node dist/cli/create-owner.js --email ...
 *
 * - 비밀번호: 터미널에서 직접 입력(화면에 안 보임, 두 번) 또는 --generate-password로 만들어 한 번만 출력
 * - TOTP 비밀키: 항상 새로 만들어 한 번만 출력 (인증 앱에 등록). 다시 볼 수 없다
 * - 활성 owner가 이미 있으면 거부. 실행 기록은 admin_audit_logs (action = cli:create-first-owner)
 * - 개발 시드(seed.ts의 DEV_ADMIN)와 별개다. 출력은 로그 수집으로 남지 않게 터미널(stdout)에만 쓴다
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { loadTokenCipher } from '../lib/token-key.js';
import { BootstrapError, createFirstOwner } from '../modules/admin/bootstrap-owner.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    'generate-password': { type: 'boolean', default: false },
  },
});

async function askHidden(prompt: string): Promise<string> {
  // 입력한 글자를 화면에 다시 쓰지 않는다
  const silent = new Writable({ write: (_chunk, _enc, done) => done() });
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  try {
    return await rl.question('');
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const email = values.email;
  if (!email) throw new BootstrapError('--email이 필요하다');
  const generate = values['generate-password'];
  if (!generate && !process.stdin.isTTY) {
    throw new BootstrapError('터미널(TTY)에서 실행하거나 --generate-password를 쓴다');
  }

  let password: string;
  if (generate) {
    password = randomBytes(18).toString('base64url'); // 24자
  } else {
    password = await askHidden('비밀번호 (12자 이상): ');
    if ((await askHidden('비밀번호 확인: ')) !== password) {
      throw new BootstrapError('비밀번호가 서로 다르다');
    }
  }

  const config = loadConfig();
  const cipher = await loadTokenCipher(config.tokenKey);
  if (!cipher) throw new BootstrapError('저장 암호화 키가 없다 (TOKEN_ENC_KEY 또는 KMS)');
  const { db, client } = createDb(config.databaseUrl, { max: 1 });
  try {
    const res = await createFirstOwner(db, cipher, { email, password });
    const lines = [
      '',
      `owner 계정을 만들었다: ${res.admin.email}`,
      ...(generate ? [`비밀번호: ${password}`] : []),
      `TOTP 비밀키: ${res.totpSecret}`,
      `TOTP 등록 URI: ${res.totpUri}`,
      '',
      '위 값은 지금 한 번만 보인다. 인증 앱에 등록하고 비밀번호는 비밀번호 관리자에 옮긴 뒤 이 화면을 지운다.',
      '',
    ];
    process.stdout.write(lines.join('\n'));
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  // 비밀번호·키가 섞일 수 있는 스택은 출력하지 않는다
  process.stderr.write(
    `${err instanceof BootstrapError ? err.message : `실패: ${(err as Error).name}`}\n`,
  );
  process.exit(1);
});
