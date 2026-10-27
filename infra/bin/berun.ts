/**
 * CDK 앱 (T-029, D-022, tech/07).
 *   지금(출시 초기): Berun-Single — 서버 1대 + KMS 토큰 키 + ECR + 백업 버킷. 사용자가 이것만 배포한다
 *   확장 단계(보관): Berun-{Staging|Prod}-Base, Berun-{Staging|Prod}-App — ECS·RDS·ElastiCache·ALB·NAT (tech/07 9장)
 *   pnpm --filter @berun/infra synth                          # 전부 synth (자격 증명 불필요)
 *   cdk deploy Berun-Single                                   # 사용자가 직접 (tech/07 3장)
 * context: keyPairName, ebsSnapshots(true) — Single / domain, certificateArn, adminAllowCidrs, imageTag — 확장 단계
 */
import { App, Tags } from 'aws-cdk-lib';
import { SingleStack } from '../lib/single-stack.js';
import { buildStage } from '../lib/stage.js';

const app = new App();
const ctx = (key: string) => {
  const v = app.node.tryGetContext(key) as unknown;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

const single = new SingleStack(app, 'Berun-Single', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-2' },
  keyPairName: ctx('keyPairName'),
  ebsSnapshots: ctx('ebsSnapshots') === 'true',
  terminationProtection: true,
});
Tags.of(single).add('stage', 'prod');

// 확장 단계 — 배포하지 않고 synth·테스트로만 유지한다
for (const stage of ['staging', 'prod'] as const) buildStage(app, stage);
Tags.of(app).add('project', 'berun');
app.synth();
