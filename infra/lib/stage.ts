import type { App } from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { AppStack } from './app-stack.js';
import { BaseStack } from './base-stack.js';
import { stageConfig, type StageName } from './config.js';

const ctx = (app: App, key: string, stage: StageName): string | undefined => {
  // 환경별 값(-c prod.certificateArn=...)이 공통 값(-c certificateArn=...)보다 우선
  const v = (app.node.tryGetContext(`${stage}.${key}`) ?? app.node.tryGetContext(key)) as unknown;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** 한 환경(staging·prod)의 기반·앱 스택 */
export function buildStage(app: App, stage: StageName) {
  const cfg = stageConfig(stage, ctx(app, 'domain', stage));
  const name = stage === 'prod' ? 'Prod' : 'Staging';
  // 계정은 배포하는 자격 증명에서 정해진다. synth는 자격 증명 없이 된다
  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: cfg.region };

  const base = new BaseStack(app, `Berun-${name}-Base`, cfg, { env });
  // 배포 때 -c imageTag=<git sha>. 없으면 자리 값 (synth 확인용, 이 태그로는 배포되지 않는다)
  const imageTag = ctx(app, 'imageTag', stage) ?? 'set-image-tag';
  const appStack = new AppStack(app, `Berun-${name}-App`, {
    env,
    cfg,
    base,
    imageTag,
    migrateImageTag: ctx(app, 'migrateImageTag', stage) ?? imageTag,
    certificateArn: ctx(app, 'certificateArn', stage),
    adminAllowCidrs: (ctx(app, 'adminAllowCidrs', stage) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    terminationProtection: stage === 'prod',
  });
  appStack.addStackDependency(base);
  for (const s of [base, appStack]) Tags.of(s).add('stage', stage);
  return { cfg, base, app: appStack };
}
