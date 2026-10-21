/** 로컬 개발용 ES256 키 쌍을 만들어 .env에 붙여 넣을 줄로 출력한다. 운영 키는 KMS·Secrets Manager로 관리한다. */
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');

console.warn('# .env에 붙여 넣는다');
console.warn(`JWT_PUBLIC_KEY=${oneLine(await exportSPKI(publicKey))}`);
console.warn(`JWT_PRIVATE_KEY=${oneLine(await exportPKCS8(privateKey))}`);
