/**
 * 환경별 설정 (T-029, tech/07). 값은 최소 사양에서 시작하고 실측 후 올린다.
 * 도메인·관리자 허용 IP·인증서는 아직 정해지지 않아([미정] PRD Q-12) cdk context로 넘긴다:
 *   cdk synth -c stage=staging -c domain=berun.app -c certificateArn=arn:... -c adminAllowCidrs=203.0.113.10/32
 */
export type StageName = 'staging' | 'prod';

export type StageConfig = {
  stage: StageName;
  /** 리소스 이름 접두 (berun-staging-…) */
  prefix: string;
  region: 'ap-northeast-2';
  network: { maxAzs: number; natGateways: number };
  db: {
    instanceType: string;
    multiAz: boolean;
    allocatedStorageGb: number;
    maxAllocatedStorageGb: number;
    /** P-RET-02: 백업에 남은 삭제 데이터가 최대 35일 안에 사라지도록 */
    backupRetentionDays: number;
    deletionProtection: boolean;
  };
  redis: { nodeType: string; replicas: number; snapshotRetentionDays: number };
  /** Fargate: vCPU 단위(256 = 0.25)·MiB */
  api: { cpu: number; memoryMiB: number; desired: number; maxCount: number };
  worker: { cpu: number; memoryMiB: number };
  admin: { cpu: number; memoryMiB: number };
  logRetentionDays: number;
  /** 운영이 아니면 푸시·소셜 연결 해제를 실제로 보내지 않는다 (서버 *_DRY_RUN) */
  dryRunExternal: boolean;
  hosts: { api: string; admin: string };
};

/** tech/01 2장 도메인(가칭). 실제 도메인은 context `domain`으로 바꾼다 */
const DEFAULT_DOMAIN = 'berun.app';

export function stageConfig(stage: StageName, domain = DEFAULT_DOMAIN): StageConfig {
  const prefix = `berun-${stage}`;
  if (stage === 'staging') {
    return {
      stage,
      prefix,
      region: 'ap-northeast-2',
      network: { maxAzs: 2, natGateways: 1 },
      db: {
        instanceType: 't4g.micro',
        multiAz: false,
        allocatedStorageGb: 20,
        maxAllocatedStorageGb: 50,
        backupRetentionDays: 7,
        deletionProtection: false,
      },
      redis: { nodeType: 'cache.t4g.micro', replicas: 0, snapshotRetentionDays: 0 },
      api: { cpu: 256, memoryMiB: 512, desired: 1, maxCount: 1 },
      worker: { cpu: 256, memoryMiB: 512 },
      admin: { cpu: 256, memoryMiB: 512 },
      logRetentionDays: 14,
      dryRunExternal: true,
      hosts: { api: `staging-api.${domain}`, admin: `staging-admin.${domain}` },
    };
  }
  return {
    stage,
    prefix,
    region: 'ap-northeast-2',
    // NAT 2개(AZ별)는 한 AZ 장애에도 워커·API의 외부 호출(Expo·소셜)이 끊기지 않게
    network: { maxAzs: 2, natGateways: 2 },
    db: {
      instanceType: 't4g.small',
      // [결정 필요] Multi-AZ는 DB 비용이 2배. 출시 초기 트래픽 기준 단일 AZ + 35일 백업으로 시작 (handoff)
      multiAz: false,
      allocatedStorageGb: 20,
      maxAllocatedStorageGb: 100,
      backupRetentionDays: 35,
      deletionProtection: true,
    },
    redis: { nodeType: 'cache.t4g.micro', replicas: 1, snapshotRetentionDays: 1 },
    api: { cpu: 512, memoryMiB: 1024, desired: 2, maxCount: 4 },
    worker: { cpu: 256, memoryMiB: 512 },
    admin: { cpu: 256, memoryMiB: 512 },
    logRetentionDays: 30,
    dryRunExternal: false,
    hosts: { api: `api.${domain}`, admin: `admin.${domain}` },
  };
}
