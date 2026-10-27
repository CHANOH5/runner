import {
  Annotations,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { BaseStack } from './base-stack.js';
import type { StageConfig } from './config.js';

export type AppStackProps = StackProps & {
  cfg: StageConfig;
  base: BaseStack;
  /** 배포할 이미지 태그 (git sha). 롤백 = 이전 태그로 다시 배포 (tech/07) */
  imageTag: string;
  /**
   * 마이그레이션 작업의 이미지 태그. 새 버전은 먼저 이 값만 올려 마이그레이션을 돌린 뒤 imageTag를 올린다 (tech/07 배포 순서)
   */
  migrateImageTag: string;
  /** ACM 인증서 (서울 리전). 없으면 HTTP만 — 도메인 확정 전 synth 확인용 */
  certificateArn: string | undefined;
  /** 관리자 웹·관리자 API에 들어올 수 있는 IP (CIDR). 비어 있으면 아무도 못 들어온다 */
  adminAllowCidrs: string[];
};

/** 앱 비밀값 (Secrets Manager `berun-{stage}/app`, JSON). 사용자가 첫 배포 전에 만든다 (tech/07) */
export const APP_SECRET_KEYS = [
  'JWT_PUBLIC_KEY',
  'JWT_PRIVATE_KEY',
  'TOKEN_ENC_KEY_KMS_CIPHERTEXT',
  'KAKAO_APP_ID',
  'KAKAO_ADMIN_KEY',
  'GOOGLE_CLIENT_IDS',
  'APPLE_CLIENT_ID',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'EXPO_ACCESS_TOKEN',
] as const;

const API_PORT = 3000;
const ADMIN_PORT = 3100;

/**
 * 앱 스택 (T-029): VPC · RDS PostgreSQL 16(PostGIS) · ElastiCache Redis · ECS Fargate(API·워커·관리자 웹)
 * · ALB + WAF(관리자 IP 제한) · S3(배번 사진 자리) · CloudWatch Logs.
 * 배포는 사용자가 직접 한다 (`cdk deploy`) — 이 저장소는 synth·테스트만 한다.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { cfg, imageTag } = props;
    const isProd = cfg.stage === 'prod';
    // 기반 스택의 키·저장소는 가져온(import) 참조로 쓴다 — 권한을 역할(IAM) 쪽에만 붙여
    // 기반 스택이 앱 스택을 참조하는 순환이 생기지 않게 (의존 방향: 앱 → 기반)
    const base = {
      dataKey: kms.Key.fromKeyArn(this, 'DataKeyRef', props.base.dataKey.keyArn),
      tokenKey: kms.Key.fromKeyArn(this, 'TokenKeyRef', props.base.tokenKey.keyArn),
      serverRepo: ecr.Repository.fromRepositoryAttributes(this, 'ServerRepoRef', {
        repositoryName: props.base.serverRepo.repositoryName,
        repositoryArn: props.base.serverRepo.repositoryArn,
      }),
      adminRepo: ecr.Repository.fromRepositoryAttributes(this, 'AdminRepoRef', {
        repositoryName: props.base.adminRepo.repositoryName,
        repositoryArn: props.base.adminRepo.repositoryArn,
      }),
    };

    // ---- 네트워크 ----
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: cfg.network.maxAzs,
      natGateways: cfg.network.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // ECS 작업: 밖으로 나가는 호출(Expo 푸시·소셜 provider·KMS·ECR)은 NAT로
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        // RDS·Redis: 인터넷 경로 없음
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });

    // 보안 그룹·규칙 설명은 EC2가 ASCII만 받는다
    const sg = (name: string, description: string) =>
      new ec2.SecurityGroup(this, `${name}Sg`, { vpc, description, allowAllOutbound: true });
    const albSg = sg('Alb', 'ALB - internet 80/443');
    const apiSg = sg('Api', 'API tasks - from ALB only');
    const adminSg = sg('Admin', 'Admin web tasks - from ALB only');
    const workerSg = sg('Worker', 'Worker and migrate tasks - no inbound');
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'RDS - from app tasks only',
      allowAllOutbound: false,
    });
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'Redis - from app tasks only',
      allowAllOutbound: false,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP redirect to HTTPS');
    apiSg.addIngressRule(albSg, ec2.Port.tcp(API_PORT), 'ALB to API');
    adminSg.addIngressRule(albSg, ec2.Port.tcp(ADMIN_PORT), 'ALB to admin web');
    for (const from of [apiSg, workerSg]) {
      dbSg.addIngressRule(from, ec2.Port.tcp(5432), 'PostgreSQL');
      redisSg.addIngressRule(from, ec2.Port.tcp(6379), 'Redis');
    }

    // ---- RDS PostgreSQL 16 + PostGIS (D-006). 확장은 마이그레이션 0000이 만든다 ----
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16,
    });
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine,
      instanceType: new ec2.InstanceType(cfg.db.instanceType),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      // 마스터 비밀번호는 배포할 때 Secrets Manager가 만든다 (저장소·템플릿에 없음)
      credentials: rds.Credentials.fromGeneratedSecret('berun', {
        secretName: `${cfg.prefix}/db`,
        encryptionKey: base.dataKey,
      }),
      databaseName: 'berun',
      multiAz: cfg.db.multiAz,
      allocatedStorage: cfg.db.allocatedStorageGb,
      maxAllocatedStorage: cfg.db.maxAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: base.dataKey,
      // P-RET-02: 자동 백업은 최대 35일 — 지운 데이터가 백업에서도 이 기간 안에 사라진다
      backupRetention: Duration.days(cfg.db.backupRetentionDays),
      preferredBackupWindow: '18:00-19:00', // UTC = 03:00~04:00 KST (정리 배치 04:20 전)
      preferredMaintenanceWindow: 'sun:19:00-sun:20:00',
      deletionProtection: cfg.db.deletionProtection,
      // 스택을 지우면 마지막 스냅숏 1개를 남긴다 (prod). 수동 스냅숏은 35일 규칙 밖이라 tech/07에서 정리 절차를 둔다
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      parameterGroup: new rds.ParameterGroup(this, 'DbParams', {
        engine,
        parameters: { 'rds.force_ssl': '1', log_min_duration_statement: '1000' },
      }),
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: cfg.logRetentionDays,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
      copyTagsToSnapshot: true,
    });

    // ---- ElastiCache Redis (세션·가입 세션·BullMQ 큐) ----
    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: `${cfg.prefix} redis`,
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });
    // BullMQ는 키 축출이 없어야 한다 (maxmemory-policy noeviction)
    const redisParams = new elasticache.CfnParameterGroup(this, 'RedisParams', {
      cacheParameterGroupFamily: 'redis7',
      description: `${cfg.prefix} BullMQ needs noeviction`,
      properties: { 'maxmemory-policy': 'noeviction' },
    });
    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: `${cfg.prefix} redis`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: cfg.redis.nodeType,
      numCacheClusters: 1 + cfg.redis.replicas,
      automaticFailoverEnabled: cfg.redis.replicas > 0,
      multiAzEnabled: cfg.redis.replicas > 0,
      cacheSubnetGroupName: redisSubnets.ref,
      cacheParameterGroupName: redisParams.ref,
      securityGroupIds: [redisSg.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      kmsKeyId: base.dataKey.keyArn,
      snapshotRetentionLimit: cfg.redis.snapshotRetentionDays,
      port: 6379,
    });
    const redisUrl = `rediss://${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}`;

    // ---- 배번 사진 비공개 버킷 (Phase 2 자리, tech/03 4장: 비공개 + 5분 서명 URL) ----
    const bibPhotos = new s3.Bucket(this, 'BibPhotos', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: base.dataKey,
      bucketKeyEnabled: true,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- ECS ----
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: cfg.prefix,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecret',
      `${cfg.prefix}/app`,
    );
    const dbSecret = db.secret!;

    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/berun/${cfg.stage}/${name.toLowerCase()}`,
        retention: cfg.logRetentionDays,
        encryptionKey: base.dataKey,
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });

    const serverEnv: Record<string, string> = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DB_HOST: db.dbInstanceEndpointAddress,
      DB_PORT: db.dbInstanceEndpointPort,
      DB_NAME: 'berun',
      REDIS_URL: redisUrl,
      TOKEN_ENC_KMS_KEY_ID: base.tokenKey.keyArn,
      PUSH_DRY_RUN: String(cfg.dryRunExternal),
      UNLINK_DRY_RUN: String(cfg.dryRunExternal),
      BIB_PHOTOS_BUCKET: bibPhotos.bucketName,
    };
    const serverSecrets: Record<string, ecs.Secret> = {
      DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      ...Object.fromEntries(
        APP_SECRET_KEYS.map((k) => [k, ecs.Secret.fromSecretsManager(appSecret, k)]),
      ),
    };

    const serverImage = (tag: string) => ecs.ContainerImage.fromEcrRepository(base.serverRepo, tag);
    const serverTask = (
      name: string,
      size: { cpu: number; memoryMiB: number },
      command: string[] | undefined,
      port?: number,
      tag = imageTag,
    ) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: size.cpu,
        memoryLimitMiB: size.memoryMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      task.addContainer(name, {
        image: serverImage(tag),
        ...(command && { command }),
        environment: serverEnv,
        secrets: serverSecrets,
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: name.toLowerCase(),
          logGroup: logGroup(name),
        }),
        ...(port && { portMappings: [{ containerPort: port }] }),
        stopTimeout: Duration.seconds(30),
      });
      // 비밀값(앱 비밀·DB 비밀번호)이 데이터 키로 암호화돼 있다
      base.dataKey.grantDecrypt(task.obtainExecutionRole());
      // 저장 암호화 데이터 키 풀기 — 같은 암호화 컨텍스트일 때만 (server lib/token-key.ts)
      task.addToTaskRolePolicy(
        new iam.PolicyStatement({
          actions: ['kms:Decrypt'],
          resources: [base.tokenKey.keyArn],
          conditions: {
            StringEquals: {
              'kms:EncryptionContext:app': 'berun',
              'kms:EncryptionContext:purpose': 'token-enc',
            },
          },
        }),
      );
      return task;
    };

    const apiTask = serverTask('Api', cfg.api, undefined, API_PORT);
    const workerTask = serverTask('Worker', cfg.worker, ['node', 'dist/worker/index.js']);
    // 배포 전에 한 번 돌리는 마이그레이션 (서비스 없음, `aws ecs run-task`, tech/07)
    const migrateTask = serverTask(
      'Migrate',
      cfg.worker,
      ['node', 'dist/db/migrate.js'],
      undefined,
      props.migrateImageTag,
    );
    bibPhotos.grantReadWrite(apiTask.taskRole);

    const service = (
      name: string,
      task: ecs.FargateTaskDefinition,
      securityGroup: ec2.SecurityGroup,
      desiredCount: number,
      extra: Partial<ecs.FargateServiceProps> = {},
    ) =>
      new ecs.FargateService(this, name, {
        cluster,
        serviceName: `${cfg.prefix}-${name.toLowerCase()}`,
        taskDefinition: task,
        desiredCount,
        securityGroups: [securityGroup],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // 새 작업이 헬스 체크를 통과하지 못하면 이전 작업 정의로 자동 롤백 (tech/07)
        circuitBreaker: { enable: true, rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        ...extra,
      });

    const apiService = service('Api', apiTask, apiSg, cfg.api.desired, {
      // 첫 owner 만들기(ECS Exec → node dist/cli/create-owner.js)
      enableExecuteCommand: true,
      healthCheckGracePeriod: Duration.seconds(30),
    });
    if (cfg.api.maxCount > cfg.api.desired) {
      apiService
        .autoScaleTaskCount({ minCapacity: cfg.api.desired, maxCapacity: cfg.api.maxCount })
        .scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });
    }
    service('Worker', workerTask, workerSg, 1);

    const adminTask = new ecs.FargateTaskDefinition(this, 'AdminTask', {
      cpu: cfg.admin.cpu,
      memoryLimitMiB: cfg.admin.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    adminTask.addContainer('Admin', {
      image: ecs.ContainerImage.fromEcrRepository(base.adminRepo, imageTag),
      environment: { NODE_ENV: 'production', PORT: String(ADMIN_PORT), HOSTNAME: '0.0.0.0' },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'admin', logGroup: logGroup('Admin') }),
      portMappings: [{ containerPort: ADMIN_PORT }],
      readonlyRootFilesystem: false,
    });
    const adminService = service('Admin', adminTask, adminSg, 1, {
      healthCheckGracePeriod: Duration.seconds(30),
    });

    // ---- ALB ----
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      dropInvalidHeaderFields: true,
    });
    const apiTg = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
      vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [apiService],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(15) },
      deregistrationDelay: Duration.seconds(30),
    });
    const adminTg = new elbv2.ApplicationTargetGroup(this, 'AdminTg', {
      vpc,
      port: ADMIN_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [adminService],
      healthCheck: { path: '/login', healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    });

    let listener: elbv2.ApplicationListener;
    if (props.certificateArn) {
      listener = alb.addListener('Https', {
        port: 443,
        open: false,
        certificates: [elbv2.ListenerCertificate.fromArn(props.certificateArn)],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultTargetGroups: [apiTg],
      });
      alb.addRedirect({ sourcePort: 80, targetPort: 443, open: false });
    } else {
      Annotations.of(this).addWarningV2(
        'berun:no-certificate',
        'certificateArn이 없어 HTTP(80)만 만든다. 운영 배포 전 -c certificateArn=... 필수 (tech/07)',
      );
      listener = alb.addListener('Http', { port: 80, open: false, defaultTargetGroups: [apiTg] });
    }
    // 관리자 웹과 관리자 API는 같은 호스트(같은 출처) — 세션 쿠키·CSRF가 그대로 동작한다 (tech/03 9-0-1)
    listener.addAction('AdminApi', {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.hostHeaders([cfg.hosts.admin]),
        elbv2.ListenerCondition.pathPatterns(['/api/admin/*']),
      ],
      action: elbv2.ListenerAction.forward([apiTg]),
    });
    listener.addAction('AdminWeb', {
      priority: 20,
      conditions: [elbv2.ListenerCondition.hostHeaders([cfg.hosts.admin])],
      action: elbv2.ListenerAction.forward([adminTg]),
    });
    // 관리자 API는 관리자 호스트로만 (API 호스트로 오면 404)
    listener.addAction('AdminApiElsewhere', {
      priority: 30,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/admin', '/api/admin/*'])],
      action: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'application/json',
        messageBody: '{"error":{"code":"NOT_FOUND","message":"not found"},"requestId":""}',
      }),
    });

    // ---- WAF: 관리자 IP 제한 + 관리형 규칙 (tech/03 4장) ----
    const visibility = (name: string) => ({
      cloudWatchMetricsEnabled: true,
      metricName: `${cfg.prefix}-${name}`,
      sampledRequestsEnabled: true,
    });
    const adminIps = new wafv2.CfnIPSet(this, 'AdminAllowIps', {
      name: `${cfg.prefix}-admin-allow`,
      scope: 'REGIONAL',
      ipAddressVersion: 'IPV4',
      addresses: props.adminAllowCidrs,
    });
    if (props.adminAllowCidrs.length === 0) {
      Annotations.of(this).addWarningV2(
        'berun:no-admin-ips',
        '관리자 허용 IP가 비어 있어 관리자 웹·API는 모두 차단된다. -c adminAllowCidrs=x.x.x.x/32 (tech/07)',
      );
    }
    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${cfg.prefix}-web`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('web'),
      rules: [
        {
          name: 'AdminAllowList',
          priority: 0,
          action: { block: {} },
          visibilityConfig: visibility('admin-block'),
          statement: {
            andStatement: {
              statements: [
                {
                  orStatement: {
                    statements: [
                      {
                        byteMatchStatement: {
                          fieldToMatch: { singleHeader: { Name: 'host' } },
                          positionalConstraint: 'EXACTLY',
                          searchString: cfg.hosts.admin,
                          textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                        },
                      },
                      {
                        byteMatchStatement: {
                          fieldToMatch: { uriPath: {} },
                          positionalConstraint: 'STARTS_WITH',
                          searchString: '/api/admin',
                          textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                        },
                      },
                    ],
                  },
                },
                {
                  notStatement: {
                    statement: { ipSetReferenceStatement: { arn: adminIps.attrArn } },
                  },
                },
              ],
            },
          },
        },
        {
          // 휴대폰 통신사 NAT 뒤 사용자가 같은 IP를 쓰므로 처음에는 세기만 한다(count). 실측 후 차단으로 (tech/07)
          name: 'RateLimitPerIp',
          priority: 1,
          action: { count: {} },
          visibilityConfig: visibility('rate'),
          statement: { rateBasedStatement: { limit: 3000, aggregateKeyType: 'IP' } },
        },
        {
          name: 'AwsCommon',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: visibility('aws-common'),
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              // 관리자 대회 저장(종목 표 포함)이 8KB를 넘을 수 있어 본문 크기 규칙은 세기만
              ruleActionOverrides: [{ name: 'SizeRestrictions_BODY', actionToUse: { count: {} } }],
            },
          },
        },
        {
          name: 'AwsKnownBadInputs',
          priority: 3,
          overrideAction: { none: {} },
          visibilityConfig: visibility('aws-bad-inputs'),
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAlb', {
      resourceArn: alb.loadBalancerArn,
      webAclArn: acl.attrArn,
    });

    // ---- 출력 (tech/07 명령에서 쓴다) ----
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'ApiHost', { value: cfg.hosts.api });
    new CfnOutput(this, 'AdminHost', { value: cfg.hosts.admin });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ApiServiceName', { value: apiService.serviceName });
    new CfnOutput(this, 'MigrateTaskDefinition', { value: migrateTask.taskDefinitionArn });
    new CfnOutput(this, 'AppSubnets', {
      value: vpc.privateSubnets.map((s) => s.subnetId).join(','),
    });
    new CfnOutput(this, 'WorkerSecurityGroup', { value: workerSg.securityGroupId });
    new CfnOutput(this, 'DbSecretName', { value: `${cfg.prefix}/db` });
    new CfnOutput(this, 'BibPhotosBucket', { value: bibPhotos.bucketName });
  }
}
