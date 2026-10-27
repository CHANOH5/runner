import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { BACKUP_RETENTION_DAYS, SingleStack } from '../lib/single-stack.js';

function synth(props: ConstructorParameters<typeof SingleStack>[2] = {}) {
  const app = new App({ analyticsReporting: false });
  return Template.fromStack(
    new SingleStack(app, 'Berun-Single', { env: { region: 'ap-northeast-2' }, ...props }),
  );
}

describe('출시 초기 서버 1대 (D-022)', () => {
  const t = synth();

  it('스냅숏 (구조가 바뀌면 리뷰에서 보이게)', () => {
    expect(t.toJSON()).toMatchSnapshot();
  });

  it('NAT·RDS·ElastiCache·ALB 없음 — 월 고정비를 만드는 리소스가 없다', () => {
    for (const type of [
      'AWS::EC2::NatGateway',
      'AWS::RDS::DBInstance',
      'AWS::ElastiCache::ReplicationGroup',
      'AWS::ElasticLoadBalancingV2::LoadBalancer',
      'AWS::ECS::Service',
    ]) {
      t.resourceCountIs(type, 0);
    }
    t.resourceCountIs('AWS::KMS::Key', 1);
  });

  it('EC2: t4g.small, IMDSv2(컨테이너 2홉), 크레딧 초과 과금 없음, 디스크 암호화', () => {
    t.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.small',
      CreditSpecification: { CPUCredits: 'standard' },
      DisableApiTermination: true,
      BlockDeviceMappings: [
        Match.objectLike({
          Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3', VolumeSize: 30 }),
        }),
      ],
    });
    t.hasResourceProperties('AWS::EC2::Instance', {
      MetadataOptions: Match.objectLike({ HttpTokens: 'required', HttpPutResponseHopLimit: 2 }),
    });
  });

  it('보안 그룹: 80·443만 (SSH 포트 없음 — SSM으로 접속)', () => {
    const sgs = Object.values(t.findResources('AWS::EC2::SecurityGroup')) as {
      Properties: { SecurityGroupIngress?: { FromPort: number }[] };
    }[];
    const ports = sgs.flatMap((s) =>
      (s.Properties.SecurityGroupIngress ?? []).map((r) => r.FromPort),
    );
    expect(ports.sort()).toEqual([443, 80]);
  });

  it('인스턴스 역할: 토큰 키 Decrypt는 암호화 컨텍스트가 맞을 때만, 액세스 키 없음', () => {
    t.hasResourceProperties('AWS::IAM::Policy', {
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
    t.resourceCountIs('AWS::IAM::AccessKey', 0);
    t.resourceCountIs('AWS::IAM::User', 0);
  });

  it('백업 권한: 올리기·읽기만, 삭제 없음', () => {
    const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('s3:PutObject');
    expect(policies).not.toMatch(/s3:DeleteObject|s3:\*/);
  });

  it('백업 버킷: 암호화·TLS만·공개 차단, 35일 뒤 삭제(P-RET-02), 버전 관리 없음', () => {
    expect(BACKUP_RETENTION_DAYS).toBeLessThanOrEqual(35);
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ ExpirationInDays: BACKUP_RETENTION_DAYS, Status: 'Enabled' }),
        ]),
      },
      VersioningConfiguration: Match.absent(),
    });
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
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

  it('고정 IP, 상태 검사 실패 시 자동 복구', () => {
    t.resourceCountIs('AWS::EC2::EIP', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'StatusCheckFailed_System',
      AlarmActions: [Match.objectLike({ 'Fn::Join': Match.anyValue() })],
    });
  });

  it('토큰 키·ECR·백업 버킷은 스택을 지워도 남는다', () => {
    t.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Retain' });
    t.allResources('AWS::ECR::Repository', { DeletionPolicy: 'Retain' });
    t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  });

  it('EBS 스냅숏은 선택 (기본 꺼짐), 켜면 7개 보관', () => {
    t.resourceCountIs('AWS::DLM::LifecyclePolicy', 0);
    synth({ ebsSnapshots: true }).hasResourceProperties('AWS::DLM::LifecyclePolicy', {
      PolicyDetails: Match.objectLike({
        Schedules: [Match.objectLike({ RetainRule: { Count: 7 } })],
      }),
    });
  });
});
