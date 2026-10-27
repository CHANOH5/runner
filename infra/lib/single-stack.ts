import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export type SingleStackProps = StackProps & {
  /** 콘솔에서 만든 EC2 키 페어 이름 (SSH over SSM·scp용). 없으면 SSM 세션만 */
  keyPairName?: string;
  /** EBS 일일 스냅숏 (DLM, 7일 보관). 기본 꺼짐 — 비용 tech/07 2장 */
  ebsSnapshots?: boolean;
};

/** 백업 보존 (P-RET-02: 삭제된 데이터가 백업에 남는 기간 최대 35일) */
export const BACKUP_RETENTION_DAYS = 35;
export const SNAPSHOT_RETENTION_COUNT = 7;

/**
 * 출시 초기 운영 — 서버 1대 (D-022, tech/07). 이 서버에서 deploy/compose.prod.yml로 모든 컨테이너를 띄운다.
 * 인바운드는 80·443뿐(SSH 포트 없음 — SSM Session Manager로 접속). 서버에 AWS 액세스 키를 두지 않고
 * 인스턴스 역할로 ECR pull·KMS Decrypt(토큰 데이터 키)·S3 백업만 한다.
 * 확장 단계(RDS·ALB·ECS)는 Berun-{Staging,Prod}-* 스택 (tech/07 9장).
 */
export class SingleStack extends Stack {
  readonly tokenKey: kms.Key;
  readonly backupBucket: s3.Bucket;
  readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: SingleStackProps = {}) {
    super(scope, id, props);
    const prefix = 'berun-single';

    // 앱 저장 암호화(TOTP 비밀키·Apple 토큰)의 데이터 키를 감싸는 키. 지우면 영영 못 푼다 — 항상 보존
    this.tokenKey = new kms.Key(this, 'TokenKey', {
      alias: `alias/${prefix}-token`,
      description: `${prefix} app token encryption data key (server lib/token-key.ts)`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
    });

    const repo = (name: string) =>
      new ecr.Repository(this, `${name}Repo`, {
        repositoryName: `${prefix}-${name.toLowerCase()}`,
        imageScanOnPush: true,
        // 같은 태그(git sha)를 덮어쓰지 못하게 — 롤백은 이전 태그로 deploy.sh (tech/07)
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{ maxImageCount: 30, description: 'keep last 30 images' }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
    const serverRepo = repo('Server');
    const adminRepo = repo('Admin');

    // 매일 pg_dump (deploy/scripts/backup.sh). 저장 암호화(SSE-S3)·TLS만·공개 차단·35일 뒤 삭제
    this.backupBucket = new s3.Bucket(this, 'BackupBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // 버전 관리를 켜면 지운 백업이 이전 버전으로 35일 넘게 남을 수 있어 끈다
      versioned: false,
      lifecycleRules: [
        { id: 'expire-backups', expiration: Duration.days(BACKUP_RETENTION_DAYS) },
        { id: 'abort-multipart', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // 공개 서브넷 하나 (NAT 없음 — 서버가 직접 인터넷으로 나간다)
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const sg = new ec2.SecurityGroup(this, 'ServerSg', {
      vpc,
      description: 'berun single server: HTTP/HTTPS only (no SSH, use SSM)',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (ACME, redirect)');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const role = new iam.Role(this, 'ServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'berun single server instance role (no access keys on the server)',
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    serverRepo.grantPull(role);
    adminRepo.grantPull(role);
    // 토큰 데이터 키는 서버 시작 때 Decrypt만, 암호화 컨텍스트가 맞을 때만
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [this.tokenKey.keyArn],
        conditions: {
          StringEquals: {
            'kms:EncryptionContext:app': 'berun',
            'kms:EncryptionContext:purpose': 'token-enc',
          },
        },
      }),
    );
    // 백업 올리기·복구용 읽기. 삭제 권한은 주지 않는다 (서버가 털려도 백업을 지울 수 없게, 삭제는 수명 주기 규칙)
    this.backupBucket.grantPut(role, 'postgres/*');
    this.backupBucket.grantRead(role, 'postgres/*');

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      // 2GB 메모리 + 스왑 2GB (빌드·순간 사용량 대비, tech/07 1.3)
      'fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile',
      "echo '/swapfile none swap sw 0 0' >> /etc/fstab",
      // Docker 공식 apt 저장소 (서명 확인)
      'install -m 0755 -d /etc/apt/keyrings',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc',
      'echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list',
      'apt-get update',
      'DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
      'snap install aws-cli --classic',
      'usermod -aG docker ubuntu',
      'install -d -o ubuntu -g ubuntu -m 0750 /opt/berun',
      // 보안 업데이트 자동 적용 (Ubuntu 기본 unattended-upgrades)
      'systemctl enable --now unattended-upgrades',
    );

    this.instance = new ec2.Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType('t4g.small'),
      // Ubuntu 24.04 LTS arm64 (배포 때 최신 AMI id를 SSM 공개 파라미터에서 읽는다)
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
        { os: ec2.OperatingSystemType.LINUX },
      ),
      securityGroup: sg,
      role,
      keyPair: props.keyPairName
        ? ec2.KeyPair.fromKeyPairName(this, 'KeyPair', props.keyPairName)
        : undefined,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: false,
          }),
        },
      ],
      httpTokens: ec2.HttpTokens.REQUIRED,
      // 컨테이너(브리지 네트워크)에서 인스턴스 역할 자격 증명을 받으려면 2홉
      httpPutResponseHopLimit: 2,
      // 버스트 크레딧을 넘겨 쓰는 추가 요금이 없게 (CPU가 계속 모자라면 확장 신호, tech/07 9장)
      creditSpecification: ec2.CpuCredits.STANDARD,
      disableApiTermination: true,
      ssmSessionPermissions: true,
    });
    Tags.of(this.instance).add('Name', `${prefix}-server`);

    // 고정 공인 IP (DNS A 레코드). IPv4 요금은 인스턴스에 붙은 동안 시간당
    const eip = new ec2.CfnEIP(this, 'Eip', {
      domain: 'vpc',
      instanceId: this.instance.instanceId,
    });

    // 하드웨어 문제로 상태 검사가 실패하면 같은 인스턴스를 다른 호스트로 옮겨 자동 복구 (EBS·IP 유지)
    new cloudwatch.Alarm(this, 'SystemStatusAlarm', {
      alarmDescription: 'berun single server system status check failed -> recover',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensionsMap: { InstanceId: this.instance.instanceId },
        statistic: 'Maximum',
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));

    if (props.ebsSnapshots) {
      // 디스크 전체(DB 볼륨 포함) 일일 스냅숏, 7개 보관 — 35일 이내 (P-RET-02)
      Tags.of(this.instance).add('berun-snapshot', 'daily');
      const dlmRole = new iam.Role(this, 'SnapshotRole', {
        assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSDataLifecycleManagerServiceRole',
          ),
        ],
      });
      new dlm.CfnLifecyclePolicy(this, 'SnapshotPolicy', {
        description: 'berun single server daily EBS snapshots',
        state: 'ENABLED',
        executionRoleArn: dlmRole.roleArn,
        policyDetails: {
          resourceTypes: ['INSTANCE'],
          targetTags: [{ key: 'berun-snapshot', value: 'daily' }],
          schedules: [
            {
              name: 'daily',
              createRule: { interval: 24, intervalUnit: 'HOURS', times: ['20:00'] },
              retainRule: { count: SNAPSHOT_RETENTION_COUNT },
              copyTags: true,
            },
          ],
        },
      });
    }

    new CfnOutput(this, 'PublicIp', { value: eip.attrPublicIp });
    new CfnOutput(this, 'InstanceId', { value: this.instance.instanceId });
    new CfnOutput(this, 'BackupBucketName', { value: this.backupBucket.bucketName });
    new CfnOutput(this, 'TokenKeyAlias', { value: `alias/${prefix}-token` });
    new CfnOutput(this, 'ServerRepoUri', { value: serverRepo.repositoryUri });
    new CfnOutput(this, 'AdminRepoUri', { value: adminRepo.repositoryUri });
  }
}
