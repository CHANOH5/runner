import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

/**
 * 기반 스택 — 앱 스택보다 먼저 배포한다 (tech/07 순서).
 * 여기 있는 KMS 키로 사용자가 저장 암호화 데이터 키를 만들고(TOKEN_ENC_KEY_KMS_CIPHERTEXT),
 * ECR에 이미지를 올린 뒤에 앱 스택을 배포해야 ECS 서비스가 뜬다.
 */
export class BaseStack extends Stack {
  /** RDS·ElastiCache·S3·CloudWatch Logs·Secrets Manager 저장 암호화 */
  readonly dataKey: kms.Key;
  /** 앱 저장 암호화(TOTP 비밀키·Apple 토큰)의 데이터 키를 감싸는 키. 앱은 Decrypt만 한다 */
  readonly tokenKey: kms.Key;
  readonly serverRepo: ecr.Repository;
  readonly adminRepo: ecr.Repository;

  constructor(scope: Construct, id: string, cfg: StageConfig, props?: StackProps) {
    super(scope, id, props);
    const retain = cfg.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/${cfg.prefix}-data`,
      description: `${cfg.prefix} data at rest (RDS, Redis, S3, logs, secrets)`,
      enableKeyRotation: true,
      removalPolicy: retain,
      pendingWindow: Duration.days(30),
    });
    // CloudWatch Logs가 이 키로 로그 그룹을 암호화할 수 있게
    this.dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(`logs.${cfg.region}.amazonaws.com`)],
        actions: [
          'kms:Encrypt*',
          'kms:Decrypt*',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:Describe*',
        ],
        resources: ['*'],
        conditions: {
          ArnLike: {
            'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${cfg.region}:${this.account}:log-group:/berun/${cfg.stage}/*`,
          },
        },
      }),
    );

    this.tokenKey = new kms.Key(this, 'TokenKey', {
      alias: `alias/${cfg.prefix}-token`,
      description: `${cfg.prefix} app token encryption data key (server lib/token-key.ts)`,
      enableKeyRotation: true,
      // 키를 지우면 암호화된 TOTP 비밀키·Apple 토큰을 영영 못 푼다 — staging도 보존
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
    });

    const repo = (name: string) =>
      new ecr.Repository(this, `${name}Repo`, {
        repositoryName: `${cfg.prefix}-${name.toLowerCase()}`,
        imageScanOnPush: true,
        // 같은 태그(git sha)를 덮어쓰지 못하게 — 롤백은 이전 태그로 재배포 (tech/07)
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{ maxImageCount: 30, description: 'keep last 30 images' }],
        removalPolicy: retain,
        emptyOnDelete: cfg.stage !== 'prod',
      });
    this.serverRepo = repo('Server');
    this.adminRepo = repo('Admin');

    new CfnOutput(this, 'TokenKeyArn', { value: this.tokenKey.keyArn });
    new CfnOutput(this, 'TokenKeyAlias', { value: `alias/${cfg.prefix}-token` });
    new CfnOutput(this, 'DataKeyAlias', { value: `alias/${cfg.prefix}-data` });
    new CfnOutput(this, 'ServerRepoUri', { value: this.serverRepo.repositoryUri });
    new CfnOutput(this, 'AdminRepoUri', { value: this.adminRepo.repositoryUri });
  }
}
