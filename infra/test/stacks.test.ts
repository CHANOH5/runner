import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageConfig } from '../lib/config.js';
import { buildStage } from '../lib/stage.js';

const cdkJson = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')) as {
  context: Record<string, unknown>;
};

/** cdk.json과 같은 context로 synth (자격 증명·AWS 호출 없음) */
function synth(stage: 'staging' | 'prod', context: Record<string, string> = {}) {
  const app = new App({ analyticsReporting: false, context: { ...cdkJson.context, ...context } });
  const stacks = buildStage(app, stage);
  return {
    ...stacks,
    base: Template.fromStack(stacks.base),
    app: Template.fromStack(stacks.app),
    appStack: stacks.app,
  };
}

const FULL = {
  certificateArn: 'arn:aws:acm:ap-northeast-2:111111111111:certificate/example',
  adminAllowCidrs: '203.0.113.10/32, 198.51.100.0/24',
  imageTag: 'abc1234',
};

describe('스냅숏 (구조가 바뀌면 리뷰에서 보이게)', () => {
  for (const stage of ['staging', 'prod'] as const) {
    it(`${stage}: 기반·앱 템플릿`, () => {
      const s = synth(stage, FULL);
      expect(s.base.toJSON()).toMatchSnapshot();
      expect(s.app.toJSON()).toMatchSnapshot();
    });
  }
});

describe('운영(prod) 규칙', () => {
  const s = synth('prod', FULL);

  it('RDS: PostgreSQL 16, 암호화, 35일 백업(P-RET-02), 삭제 보호, 비공개, SSL 강제', () => {
    s.app.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      StorageEncrypted: true,
      BackupRetentionPeriod: 35,
      DeletionProtection: true,
      PubliclyAccessible: false,
    });
    s.app.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: Match.objectLike({ 'rds.force_ssl': '1' }),
    });
    s.app.hasResource('AWS::RDS::DBInstance', { DeletionPolicy: 'Snapshot' });
  });

  it('백업 보존은 어떤 환경도 35일을 넘지 않는다', () => {
    for (const stage of ['staging', 'prod'] as const) {
      expect(stageConfig(stage).db.backupRetentionDays).toBeLessThanOrEqual(35);
    }
  });

  it('Redis: 전송·저장 암호화, BullMQ noeviction, 장애 조치', () => {
    s.app.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      TransitEncryptionEnabled: true,
      AtRestEncryptionEnabled: true,
      AutomaticFailoverEnabled: true,
      NumCacheClusters: 2,
    });
    s.app.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
      Properties: { 'maxmemory-policy': 'noeviction' },
    });
  });

  it('S3 배번 사진: 공개 차단, KMS, TLS만', () => {
    s.app.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }),
          }),
        ],
      },
    });
    s.app.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('ECS: API·워커·관리자 웹 서비스 분리, 배포 실패 시 자동 롤백, API는 ECS Exec(첫 owner)', () => {
    s.app.resourceCountIs('AWS::ECS::Service', 3);
    s.app.allResourcesProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
    s.app.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'berun-prod-api',
      EnableExecuteCommand: true,
      DesiredCount: 2,
    });
    s.app.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [Match.objectLike({ Command: ['node', 'dist/worker/index.js'] })],
    });
    s.app.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [Match.objectLike({ Command: ['node', 'dist/db/migrate.js'] })],
    });
  });

  it('마이그레이션 이미지만 먼저 올릴 수 있다 (migrateImageTag)', () => {
    const t = synth('prod', { ...FULL, migrateImageTag: 'new5678' });
    const images = Object.values(t.app.findResources('AWS::ECS::TaskDefinition')).map((r) =>
      JSON.stringify(r),
    );
    const migrate = images.filter((j) => j.includes('dist/db/migrate.js'));
    expect(migrate).toHaveLength(1);
    expect(migrate[0]).toContain(':new5678');
    expect(images.filter((j) => j.includes(':abc1234'))).toHaveLength(3); // API·워커·관리자 웹
  });

  it('API 작업: 운영 설정 — 평문 키 없음, KMS 데이터 키 암호문은 Secrets Manager에서', () => {
    const api = Object.values(
      s.app.findResources('AWS::ECS::TaskDefinition', {
        Properties: { ContainerDefinitions: [Match.objectLike({ Name: 'Api' })] },
      }),
    )[0] as {
      Properties: {
        ContainerDefinitions: {
          Environment: { Name: string; Value: unknown }[];
          Secrets: { Name: string }[];
        }[];
      };
    };
    const c = api.Properties.ContainerDefinitions[0]!;
    const env = Object.fromEntries(c.Environment.map((e) => [e.Name, e.Value]));
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PUSH_DRY_RUN: 'false',
      UNLINK_DRY_RUN: 'false',
    });
    expect(env).not.toHaveProperty('TOKEN_ENC_KEY');
    expect(env).not.toHaveProperty('DATABASE_URL'); // 비밀번호가 든 URL을 평문 환경 변수로 두지 않는다
    expect(env).not.toHaveProperty('DEV_LOGIN');
    const secrets = c.Secrets.map((x) => x.Name);
    expect(secrets).toEqual(
      expect.arrayContaining(['DB_PASSWORD', 'JWT_PRIVATE_KEY', 'TOKEN_ENC_KEY_KMS_CIPHERTEXT']),
    );
    expect(secrets).not.toContain('TOKEN_ENC_KEY');
  });

  it('토큰 키 Decrypt는 암호화 컨텍스트가 맞을 때만', () => {
    s.app.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'kms:Decrypt',
            Condition: {
              StringEquals: {
                'kms:EncryptionContext:app': 'berun',
                'kms:EncryptionContext:purpose': 'token-enc',
              },
            },
          }),
        ]),
      },
    });
  });

  it('ALB: HTTPS + 80 리디렉션, 관리자 호스트만 관리자 웹·API로', () => {
    s.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    s.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
    s.app.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 30,
      Actions: [Match.objectLike({ Type: 'fixed-response' })],
    });
  });

  it('WAF: 관리자 호스트·/api/admin은 허용 IP 밖이면 차단, ALB에 연결', () => {
    s.app.hasResourceProperties('AWS::WAFv2::IPSet', {
      Addresses: ['203.0.113.10/32', '198.51.100.0/24'],
      Scope: 'REGIONAL',
    });
    s.app.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({ Name: 'AdminAllowList', Priority: 0, Action: { Block: {} } }),
      ]),
    });
    s.app.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  it('기반: KMS 키 회전, 토큰 키는 항상 보존, ECR 태그 불변·스캔', () => {
    s.base.allResourcesProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    s.base.hasResource('AWS::KMS::Key', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ Description: Match.stringLikeRegexp('token') }),
    });
    s.base.allResourcesProperties('AWS::ECR::Repository', {
      ImageTagMutability: 'IMMUTABLE',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('로그: 데이터 키로 암호화, 보존 기간 설정', () => {
    s.app.allResourcesProperties('AWS::Logs::LogGroup', {
      KmsKeyId: Match.anyValue(),
      RetentionInDays: 30,
    });
  });
});

describe('staging', () => {
  const s = synth('staging');

  it('최소 사양: 단일 AZ DB·Redis 1노드·NAT 1개, 외부 발송 dry-run', () => {
    s.app.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t4g.micro',
      MultiAZ: false,
      BackupRetentionPeriod: 7,
    });
    s.app.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', { NumCacheClusters: 1 });
    s.app.resourceCountIs('AWS::EC2::NatGateway', 1);
    const env = JSON.stringify(s.app.findResources('AWS::ECS::TaskDefinition'));
    expect(env).toContain('"PUSH_DRY_RUN","Value":"true"');
  });

  it('인증서·관리자 IP가 없으면 경고를 남기고(HTTP만, 관리자 전부 차단) synth는 된다', () => {
    const warnings = Annotations.fromStack(s.appStack).findWarning(
      '*',
      Match.stringLikeRegexp('certificateArn|관리자 허용 IP'),
    );
    expect(warnings).toHaveLength(2);
    s.app.hasResourceProperties('AWS::WAFv2::IPSet', { Addresses: [] });
  });
});
