# 07. 운영 배포

- 담당: 개발자
- 상태: v1 초안 (T-029) — **코드·문서만 있다. AWS 리소스는 아직 하나도 만들지 않았다**
- 관련: `01-environment.md`(서버 환경), `02-tech-stack.md`(CDK·Fargate·RDS), `03-architecture.md`(4장 보안), `infra/`, `server/Dockerfile`, `admin/Dockerfile`

> 이 문서의 명령은 **사용자가 직접** 실행한다. 비용이 들고 되돌리기 어려운 작업이라 개발 세션은 `cdk deploy`·`cdk bootstrap`·이미지 push를 하지 않는다.
> CI는 `cdk synth`(템플릿 생성)와 Docker 이미지 빌드만 확인하고 AWS 자격 증명을 쓰지 않는다.

---

## 1. 구성

```
                    ┌──────────────── WAF (관리자 IP 제한·관리형 규칙) ────────────────┐
인터넷 ── ALB(443) ─┤ api.{도메인}            → API (ECS Fargate, :3000)               │
                    │ admin.{도메인}/api/admin/* → API  (같은 출처: 세션 쿠키·CSRF 그대로) │
                    │ admin.{도메인}          → 관리자 웹 (ECS Fargate, Next.js :3100)  │
                    │ 그 밖의 호스트 /api/admin/* → 404                               │
                    └──────────────────────────────────────────────────────────────┘
private(app) 서브넷: API · 워커(알림·연결 해제·정리·휴면) · 마이그레이션 일회성 작업 ── NAT → Expo·소셜·KMS
isolated(data) 서브넷: RDS PostgreSQL 16 + PostGIS · ElastiCache Redis 7 (인터넷 경로 없음)
S3: 배번 사진 비공개 버킷 (Phase 2 자리) · ECR: server·admin 이미지 · KMS: data 키, token 키
```

환경마다 스택 2개 (서울 리전 `ap-northeast-2`):

| 스택 | 내용 | 왜 나눴나 |
|---|---|---|
| `Berun-{Staging,Prod}-Base` | KMS 키 2개(`alias/berun-{stage}-data`, `-token`), ECR 저장소 2개 | 앱 스택보다 **먼저** 있어야 하는 것: 토큰 키로 데이터 키를 만들고(3단계), 이미지를 올려야(5단계) 앱 스택의 ECS 서비스가 뜬다 |
| `Berun-{Staging,Prod}-App` | VPC, RDS, Redis, ECS(API·워커·관리자 웹·마이그레이션), ALB, WAF, S3, 로그 | 일반 배포는 이 스택만 바뀐다 |

| 항목 | staging | prod | 근거 |
|---|---|---|---|
| VPC | AZ 2개, NAT 1개 | AZ 2개, NAT 2개 | prod는 한 AZ가 죽어도 외부 호출(Expo·소셜)이 된다 |
| RDS | `db.t4g.micro`, 단일 AZ, 백업 7일 | `db.t4g.small`, **단일 AZ [결정 필요]**, 백업 **35일**, 삭제 보호, 지울 때 스냅숏 | D-006, P-RET-02 (최대 35일) |
| Redis | `cache.t4g.micro` 1노드 | 2노드(자동 장애 조치), 스냅숏 1일 | BullMQ용 `maxmemory-policy=noeviction` |
| API | 0.25 vCPU / 0.5GB × 1 | 0.5 vCPU / 1GB × 2 (CPU 60% 기준 최대 4) | tech/01 3장 평시 1~2대 |
| 워커 | 0.25 / 0.5GB × 1 | 0.25 / 0.5GB × 1 | |
| 관리자 웹 | 0.25 / 0.5GB × 1 | 0.25 / 0.5GB × 1 | |
| 로그 보존 | 14일 | 30일 | CloudWatch Logs, data 키로 암호화 |
| 외부 발송 | `PUSH_DRY_RUN`·`UNLINK_DRY_RUN` = true | false | staging에서 실제 푸시·연결 해제를 보내지 않는다 |
| CPU | ARM64 (Graviton) | ARM64 | 같은 성능에 약 20% 저렴. 이미지는 `--platform linux/arm64`로 빌드 |

### 보안 (tech/03 4장)
- **저장 암호화**: RDS·Redis·S3·로그·비밀값 = KMS `data` 키. 앱이 저장하는 관리자 TOTP 비밀키·Apple refresh token = **봉투 암호화** — KMS `token` 키로 감싼 데이터 키를 앱이 시작할 때 한 번 풀어(`kms:Decrypt`, 암호화 컨텍스트 `app=berun, purpose=token-enc`일 때만 허용) 메모리에서 AES-256-GCM으로 쓴다 (`server/src/lib/token-key.ts`). 요청마다 KMS를 부르지 않는다. 운영에서는 평문 `TOKEN_ENC_KEY`를 거부한다.
- **비밀값**: Secrets Manager — `berun-{stage}/db`(RDS가 배포 때 생성), `berun-{stage}/app`(사용자가 만든다, 4단계). ECS가 필드별로 환경 변수에 넣는다. DB 비밀번호가 든 URL을 평문 환경 변수로 두지 않는다 (`DB_*` → 서버가 `DATABASE_URL` 조립, `sslmode=require`).
- **관리자 접근**: WAF 규칙 — 관리자 호스트 또는 `/api/admin`으로 오는 요청은 허용 IP(`adminAllowCidrs`) 밖이면 차단. 허용 IP가 비어 있으면 **전부 차단**(안전한 기본값). 관리자 API는 관리자 호스트로만 열리고(그 밖은 ALB에서 404) 앱의 2단계 인증·감사 로그는 그대로.
- **네트워크**: DB·Redis는 인터넷 경로가 없는 서브넷, 보안 그룹은 앱 작업에서만. RDS `rds.force_ssl=1`, Redis 전송 암호화.
- **이미지**: non-root(`node`) 사용자, 운영 의존성만, ECR 태그 불변·푸시할 때 취약점 스캔.

### 관리자 웹 호스팅 — 비교와 선택

| 방식 | 장점 | 단점 |
|---|---|---|
| **A. ECS Fargate (같은 ALB, 관리자 호스트)** ← 선택 | 관리자 API와 **같은 출처** — 지금 코드(세션 쿠키 SameSite=Strict, CSRF) 그대로. IP 제한을 API와 같은 지역 WAF 하나로. 배포·롤백·로그가 API와 같은 방식 | 작은 작업 1개 비용(월 약 $8). 컨테이너 운영 |
| B. 정적 내보내기 → S3 + CloudFront | 가장 저렴, 서버 없음 | 동적 경로(`/races/[id]`)를 정적으로 바꾸는 코드 수정 필요. 같은 출처를 위해 CloudFront에 `/api/admin/*` → ALB 동작을 따로 둬야 함. CloudFront WAF는 us-east-1 전역 WAF라 IP 제한을 두 곳에서 관리 |
| C. AWS Amplify Hosting | Next.js 그대로, 배포 간단 | 관리자 API와 출처가 달라져 쿠키·CORS 설계 변경. IP 제한이 기본 기능에 없음(WAF 연결은 별도) |

A를 고른 이유: 관리자 웹은 사용자 몇 명이 쓰는 내부 도구라 비용 차이가 작고(월 수천~1만 원), **같은 출처·IP 제한 한 곳**이라는 보안 이점과 코드 변경 없음이 더 크다.

---

## 2. 사용자가 해야 할 일 (순서대로)

> 표시: 🔐 = 비밀값이 화면·파일에 나온다(저장소·채팅에 붙이지 않는다), 💰 = 이 단계부터 비용 발생.
> 아래 `{stage}`는 `staging` 또는 `prod`, `{Stage}`는 `Staging`·`Prod`. **staging부터 끝까지 한 번 해 본 뒤 prod**를 한다.

### 0단계. 준비
1. **AWS 계정** 만들기 (회사 명의 권장). 루트 계정에 MFA, 결제 알림(Budgets: staging·prod 합계 예상치의 120%).
2. **IAM**: 루트로 작업하지 않는다. IAM Identity Center(SSO)에 관리자 사용자를 만들고 `AdministratorAccess` 권한 세트를 준다 (첫 배포 후에는 배포용 권한을 줄인다).
3. 로컬 도구: AWS CLI v2, Session Manager 플러그인(6단계 ECS Exec), Docker(buildx), Node 22·pnpm.
   ```bash
   aws configure sso            # 프로필 이름 예: berun
   export AWS_PROFILE=berun
   aws sts get-caller-identity  # 계정 번호 확인
   ```
4. **도메인** 정하기 [미정 PRD Q-12]: 기본값은 tech/01의 `api.berun.app`·`admin.berun.app`(staging은 `staging-api.`·`staging-admin.`). 다르면 아래 `-c domain=...`으로 넘긴다.

### 1단계. CDK bootstrap (계정·리전당 1번) 💰(아주 적음)
```bash
pnpm install
pnpm --filter @berun/infra exec cdk bootstrap aws://{계정번호}/ap-northeast-2
```

### 2단계. 기반 스택 배포 💰
```bash
pnpm --filter @berun/infra exec cdk deploy Berun-{Stage}-Base
```
출력: `TokenKeyAlias`, `DataKeyAlias`, `ServerRepoUri`, `AdminRepoUri`.

### 3단계. 저장 암호화 데이터 키 만들기 🔐
KMS가 데이터 키를 만들어 **암호화된 형태로만** 돌려준다. 평문 키는 어디에도 나오지 않는다.
```bash
aws kms generate-data-key-without-plaintext \
  --key-id alias/berun-{stage}-token --key-spec AES_256 \
  --encryption-context app=berun,purpose=token-enc \
  --query CiphertextBlob --output text
```
출력(base64)을 4단계의 `TOKEN_ENC_KEY_KMS_CIPHERTEXT`에 넣는다. **이 값을 바꾸거나 잃으면 저장된 TOTP 비밀키·Apple 토큰을 풀 수 없다** — 비밀값에 한 번 넣고 바꾸지 않는다 (키 교체 절차는 5장).

### 4단계. 앱 비밀값 넣기 🔐
JWT 서명 키(ES256)를 만든다:
```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out jwt-private.pem
openssl ec -in jwt-private.pem -pubout -out jwt-public.pem
```
`app-secret.json`을 만든다 (**모든 키가 있어야 한다** — 아직 없는 값은 빈 문자열. PEM은 줄바꿈을 `\n`으로):
```json
{
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "TOKEN_ENC_KEY_KMS_CIPHERTEXT": "(3단계 출력)",
  "KAKAO_APP_ID": "", "KAKAO_ADMIN_KEY": "",
  "GOOGLE_CLIENT_IDS": "",
  "APPLE_CLIENT_ID": "", "APPLE_TEAM_ID": "", "APPLE_KEY_ID": "", "APPLE_PRIVATE_KEY": "",
  "EXPO_ACCESS_TOKEN": ""
}
```
```bash
aws secretsmanager create-secret --name berun-{stage}/app \
  --kms-key-id alias/berun-{stage}-data --secret-string file://app-secret.json
rm app-secret.json jwt-private.pem   # 공개키도 비밀값에 들어갔으니 파일은 지운다
```
나중에 값 바꾸기: `aws secretsmanager put-secret-value --secret-id berun-{stage}/app --secret-string file://...` → ECS 서비스 재배포(`aws ecs update-service --force-new-deployment`)해야 반영된다.

### 5단계. 인증서와 이미지 💰
**인증서** (ACM, **서울 리전**): `api`·`admin` 호스트 두 이름(또는 `*.{도메인}`)으로 요청 → DNS 검증 레코드를 도메인 DNS에 추가 → `ISSUED`가 되면 ARN을 적어 둔다.
```bash
aws acm request-certificate --region ap-northeast-2 --validation-method DNS \
  --domain-name api.berun.app --subject-alternative-names admin.berun.app
```
**이미지** (저장소 루트에서, 태그 = git 커밋):
```bash
TAG=$(git rev-parse --short HEAD)
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin {계정번호}.dkr.ecr.ap-northeast-2.amazonaws.com
docker buildx build --platform linux/arm64 -f server/Dockerfile -t {ServerRepoUri}:$TAG --push .
docker buildx build --platform linux/arm64 -f admin/Dockerfile  -t {AdminRepoUri}:$TAG  --push .
```

### 6단계. 첫 배포 💰💰 (이때부터 월 비용 대부분이 시작된다, 4장)
관리자 접속 IP를 확인한다 (사무실 고정 IP 등, `/32`). 여러 개면 쉼표.
```bash
pnpm --filter @berun/infra exec cdk deploy Berun-{Stage}-App \
  -c imageTag=$TAG -c certificateArn={인증서 ARN} -c adminAllowCidrs=203.0.113.10/32 -c domain=berun.app
```
- RDS 생성에 10~20분 걸린다. 처음에는 테이블이 없어 API가 에러를 낼 수 있다 → 바로 아래 마이그레이션.
- **마이그레이션** (출력 `ClusterName`, `MigrateTaskDefinition`, `AppSubnets`, `WorkerSecurityGroup` 사용):
  ```bash
  aws ecs run-task --cluster berun-{stage} --launch-type FARGATE \
    --task-definition {MigrateTaskDefinition} \
    --network-configuration "awsvpcConfiguration={subnets=[{AppSubnets}],securityGroups=[{WorkerSecurityGroup}],assignPublicIp=DISABLED}"
  ```
  CloudWatch 로그 `/berun/{stage}/migrate`에 `migrations applied`가 나오면 성공.
- **DNS**: `api.`·`admin.` 호스트를 출력 `AlbDnsName`으로 CNAME(Route 53이면 ALIAS).
- 확인: `curl https://api.berun.app/health` → `{"status":"ok",...}`.

### 7단계. 첫 owner 관리자 만들기 🔐
개발 시드(`dev-owner@example.com`)는 운영에서 거부된다. 일회성 CLI로 만든다 — **활성 owner가 있으면 거부**, 실행 기록은 감사 로그(`action = cli:create-first-owner`).
```bash
TASK=$(aws ecs list-tasks --cluster berun-{stage} --service-name berun-{stage}-api --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster berun-{stage} --task $TASK --container Api --interactive \
  --command "node dist/cli/create-owner.js --email owner@{회사 도메인}"
```
- 비밀번호를 두 번 입력한다(화면에 안 보임). 직접 정하지 않으려면 `--generate-password`(24자를 만들어 한 번만 보여줌).
- 화면에 **TOTP 비밀키·등록 URI가 한 번만** 나온다 → 인증 앱에 등록, 비밀번호는 비밀번호 관리자에. 다시 볼 수 없다 (잃으면 DB에서 owner를 비활성화하고 다시 실행).
- `https://admin.berun.app` → 로그인 확인. 다른 관리자는 관리자 웹(owner)에서 만든다.

### 8단계. 출시 전 남은 것 (이 문서 밖)
- 앱 원격 설정: 관리자 `PUT /app-configs/privacy_policy_url`, `support_email`, 최소 버전 (T-026).
- 소셜 로그인 키(4단계 비밀값), Expo 프로젝트·푸시 (decisions 미결 질문).
- staging에서 `PUSH_DRY_RUN`을 끄고 싶으면 config(`dryRunExternal`)를 바꿔 배포.

---

## 3. 일반 배포 (새 버전)

마이그레이션은 **새 이미지로 먼저** 돌리고 서비스를 바꾼다. 마이그레이션은 **이전 코드와도 호환**되게 쓴다 (컬럼 추가 → 코드 배포 → 다음 배포에서 옛 컬럼 삭제).
```bash
TAG=$(git rev-parse --short HEAD); PREV={지금 배포된 태그}
# 1) 이미지 올리기 (5단계와 같음)
# 2) 마이그레이션 작업 정의만 새 이미지로 → 실행
cdk deploy Berun-{Stage}-App -c imageTag=$PREV -c migrateImageTag=$TAG {나머지 -c 같은 값}
aws ecs run-task ... (6단계와 같음)
# 3) 서비스를 새 이미지로
cdk deploy Berun-{Stage}-App -c imageTag=$TAG {나머지 -c 같은 값}
```
`-c` 값은 매번 같아야 한다 — 빠뜨리면 인증서·허용 IP가 빠진 상태로 배포된다(synth 경고가 나온다). `infra/cdk.context.json`(커밋하지 않음)에 넣어 두면 편하다.

## 4. 롤백

| 상황 | 방법 |
|---|---|
| 새 작업이 헬스 체크(`/health`)를 통과하지 못함 | **자동**: ECS 배포 서킷 브레이커가 이전 작업 정의로 되돌린다 |
| 배포는 됐지만 기능에 문제 | 이전 태그로 다시 배포: `cdk deploy Berun-{Stage}-App -c imageTag={이전 태그} ...` (ECR 태그 불변이라 그 태그 = 그때 이미지). 급하면 `aws ecs update-service --cluster berun-{stage} --service berun-{stage}-api --task-definition {이전 리비전}` (다음 cdk deploy 때 템플릿 값으로 돌아간다) |
| 마이그레이션 문제 | 마이그레이션은 앞으로만 간다. 호환되게 썼다면 코드만 롤백한다. 데이터가 상했으면 RDS **특정 시점 복구**(PITR, 백업 기간 안 아무 시각)로 새 인스턴스를 만들고 확인한 뒤 전환 — 운영 중단이 생기므로 owner가 결정 |
| 인프라 변경 문제 | 이전 커밋의 `infra/`로 `cdk deploy`. RDS·KMS·S3·ECR은 지우지 않도록(보존·삭제 보호) 되어 있다 |

## 5. 예상 월 비용 (추정)

> **추정치다.** AWS 서울 리전 온디맨드 공개 가격(2026년 기준으로 알고 있는 값)과 최소 사양·적은 트래픽(로그 수 GB, 데이터 전송 수십 GB)을 가정했다. 세금·환율·프리 티어·데이터 전송 증가는 반영하지 않았다. 배포 전 [AWS 요금 계산기](https://calculator.aws/)로 다시 확인한다. 원화는 1달러 = 1,400원 가정.

| 항목 | staging | prod | 메모 |
|---|---|---|---|
| ECS Fargate (ARM) | 약 $25 (작업 3개 × 0.25 vCPU) | 약 $50 (API 0.5 vCPU × 2 + 워커 + 관리자) | API 자동 확장 시 증가 |
| RDS PostgreSQL | 약 $21 (t4g.micro + 20GB) | 약 $43 (t4g.small + 20GB + 백업 저장 일부) | **Multi-AZ면 prod +약 $37** |
| ElastiCache Redis | 약 $15 (1노드) | 약 $30 (2노드) | |
| NAT Gateway | 약 $45 (1개) | 약 $90 (2개) | **가장 큰 고정비**. 처리 데이터 GB당 별도 |
| ALB | 약 $22 | 약 $25 | 시간 + LCU |
| WAF | 약 $10 | 약 $12 | Web ACL + 규칙 4개 + 요청 수 |
| 공인 IPv4 | 약 $11 (ALB 2 + NAT 1) | 약 $15 (ALB 2 + NAT 2) | 2024년부터 IPv4 유료 |
| KMS·Secrets Manager·ECR·S3 | 약 $4 | 약 $4 | 키 2개, 비밀 2개 |
| CloudWatch Logs | 약 $2 | 약 $8 | 수집량 기준 |
| **합계** | **약 $155 (약 22만 원)** | **약 $277 (약 39만 원)** | Multi-AZ prod면 약 $314 |

줄이는 방법 (필요할 때 결정):
- staging을 쓰지 않을 때 ECS 서비스 0개 + RDS 중지(최대 7일) → staging 약 $80 이하.
- NAT 대신 NAT 인스턴스(t4g.nano) 또는 VPC 엔드포인트 — 관리 부담·가용성과 바꾼다.
- 1년 이상 쓸 게 확실해지면 Savings Plans(Fargate)·RDS 예약 인스턴스.

## 6. 운영 메모
- **P-RET-02 (백업 35일)**: 자동 백업은 35일 뒤 사라진다. 단, **수동 스냅숏과 스택 삭제 시 남는 마지막 스냅숏은 자동으로 지워지지 않는다** — 만들었다면 35일 안에 지운다 [확인 필요: 법무 검토 시 함께].
- **WAF 요청 수 제한**은 지금 세기(count)만 한다. 휴대폰 통신사 NAT 뒤 사용자가 같은 IP를 쓰기 때문이다. 접수 오픈 시각 실측 후 차단으로 바꾼다.
- **키 교체**: KMS 키 자동 회전(연 1회)은 켜져 있다 — 감싼 데이터 키는 그대로 풀린다. 데이터 키 자체를 바꾸려면 새 데이터 키로 TOTP 비밀키·Apple 토큰을 다시 암호화하는 일회성 작업이 필요하다 (아직 없음).
- **알림**(CloudWatch 경보·SNS)과 WAF 로그는 아직 없다. 첫 배포 후 ALB 5xx·RDS CPU·ECS 작업 재시작 경보부터 추가한다.
- 헬스 체크 `/health`는 DB·Redis를 확인한다. DB가 잠깐 끊기면 모든 API 작업이 비정상으로 보일 수 있다 — 운영 실측 후 생존 확인(liveness)과 분리를 검토한다.

---
## 변경 이력
- 2026-10-27: v1 초안 (T-029) — CDK 스택 구성, 관리자 웹 호스팅 비교, 사용자 배포 순서, 일반 배포·롤백, 예상 비용
