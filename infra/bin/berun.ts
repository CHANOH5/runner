/**
 * CDK 앱 (T-029, tech/07). 스택: Berun-{Staging|Prod}-Base, Berun-{Staging|Prod}-App
 *   pnpm --filter @berun/infra synth                          # 두 환경 모두 (자격 증명 불필요)
 *   cdk deploy Berun-Staging-Base                             # 사용자가 직접 (tech/07 순서)
 * context: domain, certificateArn, adminAllowCidrs(쉼표), imageTag
 */
import { App, Tags } from 'aws-cdk-lib';
import { buildStage } from '../lib/stage.js';

const app = new App();
for (const stage of ['staging', 'prod'] as const) buildStage(app, stage);
Tags.of(app).add('project', 'berun');
app.synth();
