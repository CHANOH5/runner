# 07. 운영 배포

- 담당: 개발자
- 상태: v2 (T-029 재작업, D-022 최소 구성) — **코드·문서만 있다. AWS 리소스는 아직 하나도 만들지 않았다**
- 관련: D-022, D-006, P-RET-02, `deploy/`(compose·Caddy·스크립트), `infra/`(CDK), `server/Dockerfile`, `admin/Dockerfile`, `01-environment.md`, `03-architecture.md` 4장

> 이 문서의 AWS 명령은 **사용자가 직접** 실행한다. 비용이 들고 되돌리기 어려운 작업이라 개발 세션은 `cdk deploy`·`cdk bootstrap`·이미지 push를 하지 않는다.
> CI는 `cdk synth`, Docker 이미지 빌드, compose·Caddy 설정 검사만 하고 AWS 자격 증명을 쓰지 않는다.

---

## 1. 구성 — 서버 1대 (D-022)

```
              DNS A: api.{도메인}, admin.{도메인} → 고정 IP
                                │
인터넷 ──80/443──▶ ┌──────────── EC2 t4g.small (서울, Ubuntu 24.04, Docker Compose) ────────────┐
                  │ Caddy (자동 HTTPS, Let's Encrypt)                                         │
                  │  ├ api.{도메인}              → api:3000   (/api/admin/* 는 404)            │
                  │  ├ admin.{도메인}  허용 IP만  → /api/admin/* api:3000, 나머지 admin:3100     │
                  │  └ 127.0.0.1:8081 (SSH 터널 전용) → 위와 같은 관리자 경로                     │
                  │ api (Fastify) · worker (BullMQ) · admin (Next.js)                         │
                  │ postgres 16 + PostGIS · redis 7 (AOF, noeviction)  ← 호스트 포트 없음         │
                  │ 인스턴스 역할(액세스 키 없음): ECR pull · KMS Decrypt · S3 백업 올리기             │
                  └───────────────────────────────────────────────────────────────────────────┘
  매일 04:30 KST pg_dump ──▶ S3 백업 버킷 (암호화, 35일 뒤 자동 삭제)
  SSH 포트 없음 — 접속·터널은 SSM Session Manager
```

| 파일 | 내용 |
|---|---|
| `infra/lib/single-stack.ts` → 스택 `Berun-Single` | EC2·고정 IP·보안 그룹(80·443만)·인스턴스 역할, KMS 토큰 키, ECR 2개, 백업 버킷, 자동 복구 경보, (선택) EBS 스냅숏 |
| `deploy/compose.prod.yml` | 컨테이너 6개, 메모리 한도, 마이그레이션 일회성 서비스(`--profile ops`) |
| `deploy/Caddyfile` | 호스트별 경로, 관리자 IP 제한, 터널 리스너 |
| `deploy/.env.example`, `.env.app.example` | 서버에서 채우는 값 (커밋하지 않음) |
| `deploy/scripts/` | `deploy.sh`(배포·자동 복귀), `backup.sh`, `restore.sh`, `restore-rehearsal.sh`, `local-check.sh`(배포 전 로컬 확인) |
| `deploy/systemd/` | 매일 백업 타이머 |

앱 컨테이너는 상태가 없다(세션·작업은 Postgres·Redis에). 그래서 9장 순서로 DB·Redis를 밖으로 빼고 서버를 늘릴 수 있다.

### 1.1 서버 선택 — Lightsail vs EC2

| 기준 | Lightsail 2GB | Lightsail 4GB | **EC2 t4g.small** ← 추천 |
|---|---|---|---|
| 월 비용 (서버만) | 약 $12 [확인 필요: 서울 가격] | 약 $24 [확인 필요] | 약 $22 (인스턴스 $15 + 30GB gp3 $3 + IPv4 $4) |
| 사양 | 2 vCPU(버스트)·2GB·60GB SSD | 2 vCPU·4GB·80GB | 2 vCPU(버스트, ARM)·2GB·30GB |
| 데이터 전송 | 월 허용량 포함 | 포함 | 인터넷 송신 월 100GB 무료, 이후 GB당 약 $0.13 |
| **IAM 역할** | **없음** — 인스턴스 프로필을 붙일 수 없다 | 없음 | **있음** — 서버에 액세스 키를 두지 않는다 |
| KMS 봉투 암호화 | 최소 권한 IAM 사용자 액세스 키를 서버 `.env.app`에 둬야 함 | 같음 | 인스턴스 역할로 `kms:Decrypt` (암호화 컨텍스트 조건) |
| 스냅숏 | 수동·자동 스냅숏 (GB당 월 약 $0.05) | 같음 | EBS 스냅숏(DLM, GB당 월 약 $0.05, 증분) |
| 고정 IP | 무료(붙어 있는 동안) | 같음 | 탄력적 IP (IPv4 요금에 포함) |
| 나중에 RDS·ALB로 | VPC 피어링을 따로 설정해야 하고 Lightsail 밖 리소스와 연결이 번거롭다 | 같음 | 같은 VPC에 RDS·ElastiCache·ALB를 그대로 붙인다 |
| CDK로 관리 | 일부만 지원(L1) | 같음 | 지원 — `Berun-Single` |

**추천: EC2 t4g.small.** Lightsail 2GB보다 월 약 $10 비싸지만 ① 서버에 AWS 액세스 키가 없다(서버가 털려도 키 유출이 없고, 키 교체 관리가 없다) ② 9장 확장 단계가 같은 VPC에서 이어진다. 1년 이상 쓸 게 확실해지면 Compute Savings Plan으로 인스턴스 비용을 약 30% 줄인다.

Lightsail을 고르면 KMS·S3용 IAM 사용자를 하나 만들고(권한: 토큰 키 `kms:Decrypt` + 암호화 컨텍스트 조건, 백업 버킷 `s3:PutObject`·`GetObject`·`ListBucket`만) 액세스 키를 `.env.app`에 넣는다. 90일마다 교체한다. 다른 대안은 맞지 않는다:
- IAM Roles Anywhere: 인증서 기관(PKI)을 따로 운영해야 해서 1인 운영에 과하다.
- KMS를 빼고 평문 `TOKEN_ENC_KEY`: 키와 암호문이 같은 디스크·백업에 함께 있게 되어 저장 암호화 의미가 없다. 서버도 운영에서 평문 키를 거부한다.

### 1.2 보안
- **공개 포트는 80·443뿐.** SSH 포트를 열지 않고 SSM Session Manager로 접속한다(4장). DB·Redis는 Docker 내부 네트워크에만 있다 (`local-check.sh`가 확인).
- **저장 암호화**: EBS 볼륨 암호화, 백업 버킷 SSE-S3·TLS만·공개 차단. 관리자 TOTP 비밀키·Apple refresh token은 **봉투 암호화** — KMS 토큰 키(`alias/berun-single-token`)로 감싼 데이터 키를 앱이 시작할 때 한 번 풀어(인스턴스 역할, 암호화 컨텍스트 `app=berun, purpose=token-enc`일 때만 허용) 메모리에서 AES-256-GCM으로 쓴다 (`server/src/lib/token-key.ts`, 변경 없음).
- **비밀값**: 서버의 `deploy/.env`·`.env.app` (권한 600, 소유자 ubuntu). 저장소·채팅에 붙이지 않고 비밀번호 관리자에 사본을 둔다. Secrets Manager는 쓰지 않는다 (비밀 1개당 월 $0.4, 서버 1대에서는 이점이 작다 — 확장 단계에서 다시 쓴다).
- **백업 권한**: 서버 역할은 백업을 올리고 읽을 수만 있고 지울 수 없다. 삭제는 버킷 수명 주기 규칙만 한다.
- **이미지**: non-root(`node`), 운영 의존성만, ECR 태그 불변·푸시 시 취약점 스캔. 서버 OS는 Ubuntu 보안 업데이트 자동 적용(unattended-upgrades).

### 1.3 메모리 예산 (2GB 서버)

| 컨테이너 | 한도 | 로컬 실측 (유휴) | 메모 |
|---|---|---|---|
| Caddy | 128MB | 약 15MB | 인증서 발급 직후 잠깐 60MB까지 |
| API | 384MB | 약 70MB | Node 힙 상한 256MB, DB 연결 10 |
| 워커 | 256MB | 약 70MB | 힙 192MB, DB 연결 4 |
| 관리자 웹 | 192MB | 약 45MB | 힙 128MB |
| PostgreSQL | 512MB | 약 35~85MB | `shared_buffers` 128MB, `max_connections` 40 |
| Redis | 128MB | 약 5MB | `maxmemory` 96MB, noeviction (차면 쓰기 오류 → 9장 신호) |
| **합계** | **1.6GB** | 약 0.3GB | + OS·Docker 약 0.3GB, 스왑 2GB(서버 생성 시 자동) |

한도 합계가 메모리보다 약간 작다. 한 컨테이너가 한도를 넘으면 그 컨테이너만 재시작된다(`restart: unless-stopped`). 사용자가 늘어 실사용이 한도에 붙으면 9장 0단계(서버 키우기)로 간다.

---

## 2. 예상 월 비용 (추정)

> **추정치다.** AWS 서울 리전 온디맨드 공개 가격(알고 있는 2026년 값)과 적은 트래픽을 가정했다. 세금·환율·프리 티어 변동은 반영하지 않았다. 배포 전 [AWS 요금 계산기](https://calculator.aws/)로 다시 확인한다. 1달러 = 1,400원 가정.

| 항목 | EC2 추천안 | Lightsail 2GB안 | 메모 |
|---|---|---|---|
| 서버 | 약 $15.2 (t4g.small) | 약 $12 (디스크·IPv4·전송 포함) | EC2는 크레딧 초과 과금 없음(standard) |
| 디스크 | 약 $2.7 (gp3 30GB) | 포함 | |
| 공인 IPv4 | 약 $3.7 | 포함 | |
| KMS 키 1개 | 약 $1 | 약 $1 | 요청은 시작할 때 1번 |
| ECR (이미지 보관) | 약 $0.3 | 약 $0.3 | 최근 30개, GB당 $0.10 |
| S3 백업 | 약 $0.1 | 약 $0.1 | 덤프 100MB × 35개 기준. DB가 커지면 비례 |
| CloudWatch 경보 1개 | 약 $0.1 | — | 하드웨어 장애 자동 복구 |
| 데이터 전송 | $0 (월 100GB까지) | 포함 | |
| **합계** | **약 $23 (약 3만 2천 원)** | **약 $14 (약 2만 원)** | 목표 $30 이하 |
| (선택) EBS 일일 스냅숏 7개 | +약 $1~2 | 수동 스냅숏 GB당 $0.05 | 증분이라 첫 회만 크다. `-c ebsSnapshots=true` |
| (선택) 1년 Savings Plan | 서버 -약 $4.5 | — | 사용이 확실해진 뒤 |

T-029 1차안(staging+prod ECS·RDS·NAT, 월 약 $430)과 비교하면 약 1/18이다. 비용 대신 받아들이는 것: **서버 1대 장애 = 서비스 중단**(하드웨어 장애는 자동 복구 경보로 수 분 안에 다른 호스트에서 재시작), **데이터 손실 최대 24시간**(매일 백업, 6장), 배포 중 수 초 끊김.

---

## 3. 사용자가 해야 할 일 (순서대로)

> 🔐 = 비밀값이 화면·파일에 나온다(저장소·채팅에 붙이지 않는다), 💰 = 이 단계부터 비용 발생.

### 0단계. 준비
1. **AWS 계정** (회사 명의 권장). 루트 계정 MFA. **Budgets 알림 월 $40**.
2. **IAM Identity Center**에 관리자 사용자 + `AdministratorAccess` 권한 세트. 루트로 작업하지 않는다.
3. 로컬 도구: AWS CLI v2, [Session Manager 플러그인](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html), Docker(buildx), Node 22·pnpm.
   ```bash
   aws configure sso            # 프로필 이름 예: berun
   export AWS_PROFILE=berun
   aws sts get-caller-identity
   ```
4. **도메인** [미정 PRD Q-12]: 기본값 `api.berun.app`·`admin.berun.app`. DNS를 바꿀 수 있는 곳(가비아·Route 53 등)이 있어야 한다.
5. (권장) EC2 콘솔 → 키 페어 → `berun` (ED25519) 만들기 → `.pem`을 `~/.ssh/berun.pem`(권한 600)에 저장. 파일 복사(scp)에 쓴다. SSH 포트는 열지 않고 SSM을 거친다.

### 1단계. 서버 만들기 💰
```bash
pnpm install
pnpm --filter @berun/infra exec cdk bootstrap aws://{계정번호}/ap-northeast-2      # 계정·리전당 1번
pnpm --filter @berun/infra exec cdk deploy Berun-Single -c keyPairName=berun
```
출력: `PublicIp`, `InstanceId`, `BackupBucketName`, `TokenKeyAlias`, `ServerRepoUri`, `AdminRepoUri`. 서버는 처음 몇 분 동안 Docker를 설치한다.

`~/.ssh/config`에 추가 (SSM을 거치는 SSH — 22번 포트를 열지 않는다):
```
Host berun
  HostName {InstanceId}
  User ubuntu
  IdentityFile ~/.ssh/berun.pem
  ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region ap-northeast-2
```
확인: `ssh berun 'docker compose version && aws --version'`.

### 2단계. 도메인 연결
DNS에 A 레코드 2개: `api.{도메인}`, `admin.{도메인}` → `PublicIp`. **AAAA(IPv6) 레코드는 만들지 않는다** — IPv6로 들어오면 관리자 IP 제한이 실제 접속 IP를 보지 못할 수 있다.

### 3단계. 비밀값 만들기 🔐
**저장 암호화 데이터 키** — KMS가 **감싼 형태로만** 돌려준다. 평문 키는 어디에도 나오지 않는다:
```bash
aws kms generate-data-key-without-plaintext \
  --key-id alias/berun-single-token --key-spec AES_256 \
  --encryption-context app=berun,purpose=token-enc \
  --query CiphertextBlob --output text
```
**이 값을 바꾸거나 잃으면 저장된 TOTP 비밀키·Apple 토큰을 풀 수 없다.** 비밀번호 관리자에 보관한다.

**JWT 서명 키(ES256)**:
```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out jwt-private.pem
openssl ec -in jwt-private.pem -pubout -out jwt-public.pem
awk 'NF {printf "%s\\n", $0}' jwt-private.pem; echo     # .env.app에 넣을 한 줄 형식
```
**DB·Redis 비밀번호**: `openssl rand -hex 24`를 두 번.

### 4단계. 이미지 올리기 💰(아주 적음)
저장소 루트에서, 태그 = git 커밋. Apple Silicon Mac은 arm64를 그대로 빌드한다.
```bash
deploy/scripts/local-check.sh                 # 배포 전 로컬 확인 (7장)
TAG=$(git rev-parse --short HEAD)
REG={계정번호}.dkr.ecr.ap-northeast-2.amazonaws.com
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin $REG
docker buildx build --platform linux/arm64 -f server/Dockerfile -t $REG/berun-single-server:$TAG --push .
docker buildx build --platform linux/arm64 -f admin/Dockerfile  -t $REG/berun-single-admin:$TAG  --push .
```

### 5단계. 서버에 설정 올리고 첫 배포 🔐
```bash
rsync -a --exclude '.env' --exclude '.env.app' deploy/ berun:/opt/berun/deploy/
ssh berun
cd /opt/berun/deploy
cp .env.example .env && cp .env.app.example .env.app && chmod 600 .env .env.app
nano .env        # 이미지 주소, 도메인, ACME_EMAIL, POSTGRES_PASSWORD, REDIS_PASSWORD, BACKUP_BUCKET
nano .env.app    # JWT 키 2개, TOKEN_ENC_KEY_KMS_CIPHERTEXT (3단계), 소셜 키(있으면)
scripts/deploy.sh {TAG}
```
`deploy.sh`가 이미지 받기 → 마이그레이션 → 기동 → `/health` 확인까지 한다. 로컬에서 `curl https://api.{도메인}/health` → `{"status":"ok",...}`. 인증서는 Caddy가 처음 요청 때 발급한다(수십 초).

### 6단계. 백업 켜기
```bash
# 서버에서
sudo cp /opt/berun/deploy/systemd/berun-backup.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now berun-backup.timer
/opt/berun/deploy/scripts/backup.sh               # 지금 한 번
/opt/berun/deploy/scripts/restore-rehearsal.sh    # 방금 백업이 복원되는지
```

### 7단계. 첫 owner 관리자 만들기 🔐
개발 시드(`dev-owner@example.com`)는 운영에서 거부된다. 일회성 CLI로 만든다 — **활성 owner가 있으면 거부**, 실행 기록은 감사 로그(`cli:create-first-owner`).
```bash
# 서버에서
cd /opt/berun/deploy
docker compose -f compose.prod.yml --profile ops run --rm migrate \
  node dist/cli/create-owner.js --email owner@{회사 도메인}
```
- 비밀번호를 두 번 입력한다(화면에 안 보임). 직접 정하지 않으려면 `--generate-password`.
- **TOTP 비밀키·등록 URI가 한 번만** 나온다 → 인증 앱에 등록. 다시 볼 수 없다.
- 관리자 웹 접속은 4장. 다른 관리자는 관리자 웹(owner)에서 만든다.

### 8단계. 출시 전 남은 것 (이 문서 밖)
- 앱 원격 설정: 관리자 `PUT /app-configs/privacy_policy_url`, `support_email`, 최소 버전 (T-026).
- 소셜 로그인 키·Expo 푸시 (decisions 미결 질문) → `.env.app`에 넣고 `docker compose -f compose.prod.yml up -d api worker`.
- 외부 가동 확인(무료 업타임 모니터 등)으로 `/health` 감시 — 6.3.

---

## 4. 관리자 접근

**기본: 공개 인터넷에 열지 않는다.** `.env`의 `ADMIN_ALLOW_CIDRS`가 비어 있으면 `admin.{도메인}`은 누구에게나 403이다. 관리자는 터널로 들어간다:

```bash
# 로컬에서 (키 페어 없이도 된다)
aws ssm start-session --target {InstanceId} --region ap-northeast-2 \
  --document-name AWS-StartPortForwardingSession --parameters portNumber=8081,localPortNumber=8081
# 또는 1단계의 SSH 설정으로: ssh -N -L 8081:127.0.0.1:8081 berun
```
브라우저에서 `http://localhost:8081` → 로그인. 터널 리스너는 서버 루프백(127.0.0.1:8081)에만 열려 있고, 같은 출처로 `/api/admin/*`를 API에 보내므로 세션 쿠키(SameSite=Strict)·CSRF 헤더가 그대로 동작한다. 터널에 들어오려면 AWS 로그인(IAM Identity Center, MFA)이 필요하다.
- 운영 세션 쿠키는 `Secure`다. Chrome·Edge·Firefox는 `http://localhost`를 안전한 출처로 보고 쿠키를 저장한다. Safari는 저장하지 않을 수 있다 [확인 필요] → **Chrome 권장**.

**선택: 고정 IP에서 바로 접속.** 사무실 고정 IP가 있으면 `.env`에 `ADMIN_ALLOW_CIDRS="203.0.113.10/32"`(공백으로 여러 개) → `docker compose -f compose.prod.yml up -d proxy`. 이후 `https://admin.{도메인}`. 처음 한 번 Caddy 로그(`docker compose -f compose.prod.yml logs proxy`)에서 `remote_ip`가 실제 내 IP로 찍히는지 확인한다.

어느 쪽이든 앱 호스트(`api.`)의 `/api/admin/*`는 404이고, 관리자 2단계 인증·감사 로그는 그대로다.

---

## 5. 일반 배포·롤백

**배포** (새 버전):
1. 로컬: `deploy/scripts/local-check.sh` 통과 (7장)
2. 로컬: 4단계와 같이 이미지 빌드·push (`TAG=$(git rev-parse --short HEAD)`)
3. `deploy/` 파일이 바뀌었으면 5단계의 `rsync`
4. 서버: `/opt/berun/deploy/scripts/deploy.sh $TAG`

`deploy.sh`는 **마이그레이션을 먼저** 돌리고 컨테이너를 교체한다. 그래서 마이그레이션은 **이전 코드와도 호환**되게 쓴다 (컬럼 추가 → 코드 배포 → 다음 배포에서 옛 컬럼 삭제). 컨테이너 교체 중 수 초 동안 요청이 실패할 수 있다 — 사용이 적은 시간에 배포한다.

**롤백**

| 상황 | 방법 |
|---|---|
| 새 버전이 `/health`를 통과하지 못함 | **자동**: `deploy.sh`가 직전 태그로 되돌린다 |
| 배포는 됐지만 기능에 문제 | `scripts/deploy.sh {이전 태그}` (기록: `deploy/.deploy-history`). ECR 태그 불변이라 그 태그 = 그때 이미지 |
| 마이그레이션 문제 | 앞으로만 간다. 호환되게 썼다면 코드만 롤백. 데이터가 상했으면 6장 복구 — 운영 중단이 생기므로 owner가 결정 |
| 서버 설정(compose·Caddy) 문제 | 이전 커밋의 `deploy/`를 `rsync` → `docker compose -f compose.prod.yml up -d` |
| 서버 자체 문제 | 하드웨어: 자동 복구 경보. OS가 망가짐: EBS 스냅숏(켰다면)으로 볼륨 복원, 아니면 새 서버 + 6장 백업 복원 |

---

## 6. 백업·복구 (P-RET-02)

### 6.1 매일 백업
- `berun-backup.timer`가 매일 04:30 KST에 `backup.sh` 실행: `pg_dump`(custom 형식) → 목차 읽기로 손상 확인 → `s3://{BackupBucketName}/postgres/daily/berun-{UTC 시각}.dump`.
- 버킷: SSE-S3 암호화, TLS만, 공개 차단, 버전 관리 없음, **35일 뒤 자동 삭제**(수명 주기). 삭제는 비동기라 만료 후 실제 삭제까지 약간 늦을 수 있다 [확인 필요: S3 수명 주기 지연과 P-RET-02 해석, 법무 검토 시 함께].
- 결과: `journalctl -u berun-backup.service`. 실패 알림은 아직 없다 (6.3).
- **복구 시점 목표(RPO) 최대 24시간.** 더 짧게 하려면 타이머를 6시간마다로 바꾼다(비용 거의 없음, 결정 요청).

### 6.2 복구
1. **리허설 먼저** (운영 DB를 건드리지 않음): `scripts/restore-rehearsal.sh [s3://…/파일.dump]` — 네트워크 없는 임시 PostgreSQL에 복원하고 마이그레이션 수·PostGIS·주요 테이블 행 수를 보여준 뒤 지운다. 인자가 없으면 가장 최근 백업. 로컬 파일도 된다.
2. **실제 복구**: `scripts/restore.sh s3://…/파일.dump` — `restore` 입력 확인 → 지금 DB를 한 번 더 백업(안전망) → api·worker 정지 → DB 다시 만들기 → `pg_restore` → 마이그레이션 → 기동. 백업 이후 데이터는 사라진다.
3. **월 1회 리허설**을 권장한다. 출력의 "복원 시간"이 15분을 넘으면 9장 ① 신호다.

### 6.3 서버 스냅숏 (선택)
`cdk deploy Berun-Single -c keyPairName=berun -c ebsSnapshots=true` → 매일 EBS 스냅숏 7개 보관(DLM). 월 약 $1~2. DB 백업과 달리 OS·설정·인증서까지 통째로 돌릴 수 있다. 7일 보관이라 P-RET-02(35일) 안이다.

---

## 7. staging 대신 — 배포 전 로컬 확인

상시 staging은 두지 않는다 (D-022). 배포 전마다:
```bash
deploy/scripts/local-check.sh            # 운영 이미지 빌드 → compose.prod.yml 그대로 기동 → 점검 → 정리
SKIP_BUILD=1 KEEP=1 deploy/scripts/local-check.sh   # 빌드 생략, 끝나도 띄워 둠
```
점검 항목: API `/health`(HTTPS), HTTP→HTTPS 리디렉션, 앱 호스트의 관리자 API 404, 관리자 호스트 허용 IP 없으면 403, 터널로 관리자 웹 200·관리자 API 401, Postgres·Redis 포트 비공개, 컨테이너별 메모리.
운영과 다른 점: KMS가 없어 `NODE_ENV=test` + 일회용 평문 키, 도메인은 `*.localhost`(Caddy 내부 인증서), 포트 18080·18443·18081.

실기기 앱 연결처럼 진짜 도메인이 필요하면 **임시 서버**: EC2 콘솔에서 t4g.small을 하나 띄워(시간당 약 $0.03) 같은 compose로 확인하고 지운다. 운영 서버에 두 번째 compose를 띄우지 않는다 (메모리 부족).

---

## 8. 운영 메모
- **모니터링**: 지금은 하드웨어 자동 복구 경보 하나뿐이다. 출시 전 외부 업타임 감시(`/health`, 무료 서비스)를 두고, 다음 작업으로 CloudWatch 에이전트(메모리·디스크) + 백업 실패 알림을 붙인다.
- **로그**: 컨테이너별 10MB × 5개 순환 (`docker compose logs`). 장기 보관 없음.
- **디스크**: 30GB. 주 1회 `df -h` 확인, 70%를 넘으면 EBS 크기 늘리기(온라인 가능).
- **CPU 크레딧**: t4g.small은 기준 성능이 vCPU의 20%이고 남는 크레딧으로 버스트한다. standard 모드라 크레딧이 바닥나면 느려질 뿐 추가 요금은 없다 → 콘솔의 `CPUCreditBalance`가 자주 0이면 9장 0단계.
- **키 교체**: KMS 키 자동 회전(연 1회)은 켜져 있다 — 감싼 데이터 키는 그대로 풀린다. 데이터 키 자체를 바꾸려면 재암호화 일회성 작업이 필요하다 (아직 없음).
- **PostgreSQL 메이저 업그레이드**: 같은 서버에서 `pg_dump` → 새 버전 볼륨에 복원. 9장 ①(RDS)로 옮길 때 같이 하는 것이 쉽다.
- `/health`는 DB·Redis를 확인한다.

---

## 9. 확장 기준과 순서

앱 컨테이너는 상태가 없으므로 **한 번에 하나씩** 밖으로 뺀다. 아래 신호 중 하나가 **1~2주 지속**되면 다음 단계를 검토한다.

| 신호 | 기준 (제안) | 확인 방법 |
|---|---|---|
| CPU | 평균 사용률 60% 이상, 또는 `CPUCreditBalance`가 자주 0 | EC2 콘솔 지표 |
| 메모리 | 가용 메모리 300MB 미만 지속, 스왑 계속 사용, 컨테이너 OOM 재시작 | `free -m`, `docker stats`, `docker compose ps` |
| DB | 크기 10GB 이상, 복구 리허설 15분 초과, 특정 시점 복구(PITR) 필요 | `restore-rehearsal.sh` 출력 |
| Redis | 사용량 `maxmemory` 70% 이상 (noeviction이라 차면 작업 등록 실패) | `redis-cli info memory` |
| 가용성 | 서버 1대 중단(배포·장애)을 받아들일 수 없게 됨 | 서비스 판단 |
| **Phase 3 라이브 시작 전** | 대회 당일 실시간 위치·응원 트래픽 급증, 중단 불가 | **신호와 관계없이 ①②③을 마친다** |

| 단계 | 하는 일 | 월 비용 증가 (추정) | 중단 |
|---|---|---|---|
| 0. 서버 키우기 | t4g.medium(4GB)으로 유형 변경, compose 메모리 한도 올림 | +약 $15 | 수 분 (중지 → 유형 변경 → 시작) |
| ① DB → RDS | 같은 VPC에 RDS PostgreSQL 16(t4g.micro~small, 단일 AZ, 백업 35일). `pg_dump`/`pg_restore`로 이전, `.env.app`에 `DB_*`(서버가 `sslmode=require` URL 조립). compose에서 postgres·백업 타이머 제거 | +약 $21~43 (Multi-AZ면 ×2) | 이전하는 동안 (DB 크기에 비례, 수십 분) |
| ② Redis → ElastiCache | cache.t4g.micro, noeviction, TLS. 대기 작업이 없는 시각에 전환 | +약 $15 | 수 분 |
| ③ 서버 2대 + ALB | 앱 서버를 같은 이미지로 2대, ALB(ACM 인증서) 뒤로. Caddy 대신 ALB 호스트 규칙, 관리자 IP 제한은 WAF. 워커는 1대에서만 | +약 $22(서버) + $22(ALB) + $10(WAF) | 거의 없음 (DNS 전환) |
| ④ CDK 확장 스택으로 전환 | `Berun-Prod-Base/App` (ECS Fargate·RDS·ElastiCache·ALB·WAF·NAT). 자동 확장·자동 롤백·Secrets Manager | 합계 약 $280 (T-029 1차안, NAT 2개 기준) | 단계별 이전 |

- ①~③의 리소스는 `Berun-Single`에 단계별로 추가하거나, ④로 한 번에 옮긴다. ④로 옮길 때 **KMS 토큰 키는 새로 만들지 않고 `alias/berun-single-token`을 그대로 써야 한다**(데이터 키가 그 키로 감싸여 있다) — 그때 확장 스택이 기존 키를 가져오도록 고친다.
- 확장 단계 CDK(`infra/lib/base-stack.ts`, `app-stack.ts`, `stage.ts`)는 지금 배포하지 않지만 CI `cdk synth`·스냅숏 테스트로 깨지지 않게 유지한다. 구성 상세는 아래 부록.

### 부록: 확장 단계 CDK 구성 (T-029 1차안, 보관)

환경별 스택 2개 `Berun-{Staging,Prod}-Base`(KMS data·token 키, ECR) / `Berun-{Staging,Prod}-App`(VPC·NAT, RDS 백업 35일·삭제 보호·`rds.force_ssl`, ElastiCache noeviction·TLS, ECS Fargate ARM64 API·워커·관리자 웹 + 마이그레이션 작업, ALB 호스트 라우팅, WAF 관리자 IP 허용 목록(비면 전부 차단)·관리형 규칙, S3 배번 사진 자리, CloudWatch Logs). 배포 순서는 기반 스택 → KMS 데이터 키·Secrets Manager `berun-{stage}/app` → ACM 인증서·이미지 → 앱 스택(`-c imageTag -c certificateArn -c adminAllowCidrs -c domain`) → `aws ecs run-task` 마이그레이션 → 첫 owner는 ECS Exec. 일반 배포는 `-c migrateImageTag`로 마이그레이션 먼저. 1차안 비용 추정: staging 약 $155, prod 약 $277 (Multi-AZ 약 $314) — NAT가 가장 큰 고정비. 관리자 웹 호스팅은 Fargate(같은 ALB, 같은 출처)를 골랐다 (S3+CloudFront는 정적 내보내기·출처 분리, Amplify는 출처 분리·IP 제한 부재). 상세는 이 문서 v1(git 기록 `811bc6a`).

---
## 변경 이력
- 2026-10-27: v1 초안 (T-029) — CDK 스택 구성, 관리자 웹 호스팅 비교, 사용자 배포 순서, 일반 배포·롤백, 예상 비용
- 2026-10-27: v2 (T-029 재작업, D-022) — 서버 1대 최소 구성(EC2 t4g.small + Docker Compose + Caddy), Lightsail 비교, 메모리 예산, 월 약 $23, 관리자 SSM 터널·IP 허용 목록, 매일 백업·복구 리허설, 로컬 확인으로 staging 대체, 확장 기준·순서. v1 CDK는 확장 단계로 보관
