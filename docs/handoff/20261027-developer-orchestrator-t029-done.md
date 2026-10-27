# T-029 운영 배포 준비 완료 — 검토·병합 요청, 결정 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청, 결정 요청 5건)
- 관련 ID: T-029, D-006, P-RET-02, PRD Q-12, tech/07
- 상태: 열림

## 내용

브랜치 `claude/infra-t029`(main `4c4600a` 기준)에 T-029를 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**AWS 리소스는 하나도 만들지 않았다.** `cdk deploy`·`bootstrap`·이미지 push를 하지 않았고, AWS 자격 증명도 쓰지 않았다. 배포는 사용자가 `docs/tech/07-deploy.md` 2장 순서로 직접 한다.

**만든 것**
1. `infra/` (AWS CDK, TypeScript). 환경마다 스택 2개다 (서울 리전).
   - `Berun-{Staging,Prod}-Base`: KMS 키 2개(data·token), ECR 2개
   - `Berun-{Staging,Prod}-App`: VPC, RDS PostgreSQL 16, ElastiCache Redis 7, ECS Fargate(API·워커·관리자 웹 + 마이그레이션 작업), ALB, WAF, S3(배번 사진 자리), CloudWatch Logs
   - RDS 백업은 prod 35일·staging 7일이다 (P-RET-02 최대 35일).
   - 관리자 접근: WAF가 관리자 호스트와 `/api/admin`을 허용 IP 밖에서 차단한다. 허용 IP가 비면 전부 차단한다.
   - 관리자 웹 호스팅: ECS Fargate를 같은 ALB 뒤에 둔다. 비교와 이유는 tech/07 1장에 있다 (같은 출처 + IP 제한 한 곳 + 코드 변경 없음).
2. `TOKEN_ENC_KEY` → KMS (`server/src/lib/token-key.ts`)
   - 봉투 암호화다. KMS로 감싼 데이터 키를 시작할 때 한 번 풀고, 이후는 지금과 같은 AES-256-GCM이다. 그래서 기존 암호기 인터페이스와 데이터 형식이 그대로다.
   - 운영(`NODE_ENV=production`)에서는 평문 `TOKEN_ENC_KEY`를 거부하고 KMS 암호문을 필수로 한다. 로컬·테스트는 지금 방식 그대로다.
3. 운영 첫 owner CLI `server/src/cli/create-owner.ts`
   - 비밀번호는 숨김 입력 또는 `--generate-password`로 만든다. TOTP는 한 번만 출력한다.
   - 활성 owner가 있으면 거부한다. 동시에 실행해도 owner는 하나만 생긴다 (advisory lock).
   - 감사 로그 `cli:create-first-owner`를 남긴다. 개발 시드와는 별개다.
4. Docker 이미지 `server/Dockerfile`(API·워커·마이그레이션 공용), `admin/Dockerfile`(Next.js standalone)
   - 멀티 스테이지, non-root(`node`), 운영 의존성만 담는다.
5. `docs/tech/07-deploy.md`: 구성, 사용자 단계(0~8), 일반 배포(마이그레이션 먼저), 롤백, 예상 비용
6. CI: `cdk synth` 단계와 Docker 빌드 작업(server·admin, push 없음)을 추가했다. 배포와 자격 증명은 없다.

**서버 코드 변경 (작음)**
- `DB_HOST·DB_PORT·DB_NAME·DB_USER·DB_PASSWORD`로 `DATABASE_URL`을 조립한다 (`sslmode=require`). ECS가 RDS 비밀 필드를 넣기 위해서다. `DATABASE_URL`이 있으면 그것을 쓴다.
- 공지 모듈(`server/src/modules/notifications`의 공지 부분)은 건드리지 않았다 (개발-앱 세션 작업과 겹치지 않게). 바꾼 파일은 config/env, app.ts, server.ts, worker/index.ts, lib, admin 모듈의 bootstrap-owner, cli, 테스트 helpers·fixtures다.

**확인**
- 실제 출력: `cdk synth` → 4개 스택 `Successfully synthesized`. 경고는 의도한 2종뿐이다 (인증서 없음 → HTTP만, 관리자 허용 IP 없음 → 전부 차단). CloudFormation 검증 경고는 0이다 (보안 그룹 설명이 한글이면 배포 실패여서 ASCII로 바꿨다).
- 테스트: 서버 264 (기존 250 + KMS·DB 주소 10 + 첫 owner 4), infra 16 (스냅숏 4 + 규칙), 관리자 9, 앱 85. lint·typecheck·build 통과
- Docker: 두 이미지를 로컬에서 빌드하고 실행했다. 서버 이미지는 마이그레이션 성공, `/health` ok, 워커 시작, production 설정에서 KMS 암호문이 없으면 시작 거부를 확인했다. 관리자 이미지는 `/login`·정적 파일 200을 확인했다. 둘 다 `node` 사용자로 실행된다.
- 첫 owner CLI: 로컬 DB에서 "활성 owner가 이미 있다" 거부, TTY 없이 실행하면 거부되는 것을 확인했다.

**예상 월 비용 (추정, tech/07 5장)**: staging 약 $155(약 22만 원), prod 약 $277(약 39만 원). prod Multi-AZ면 약 $314다. 가장 큰 고정비는 NAT다.

**결정 요청**
1. **prod RDS Multi-AZ**: 지금은 단일 AZ + 35일 백업 + 특정 시점 복구다. Multi-AZ로 하면 월 +약 $37이고 AZ 장애 시 자동 전환된다. 출시 시점에 켤지 정해 달라.
2. **NAT Gateway 수**: prod 2개(AZ별), staging 1개다. prod를 1개로 줄이면 월 -약 $45이고, 그 AZ가 장애일 때 외부 호출(푸시·소셜)이 끊긴다.
3. **staging 상시 운영 여부**: 안 쓸 때 ECS 0개 + RDS 중지로 줄이면 약 $80 이하다. 운영 방식을 정해 달라.
4. **도메인·관리자 허용 IP**(PRD Q-12 미결): 첫 배포 전에 필요하다. 기본값은 `api.berun.app`·`admin.berun.app`이다. 관리자 접속 IP(사무실 고정 IP 등)가 없으면 VPN 등 다른 방법을 정해야 한다.
5. **예산 승인과 첫 배포 시점**: AWS 계정 생성·IAM·bootstrap부터 사용자 몫이다. 결제 알림(Budgets) 설정을 권한다.

**사용자가 해야 할 일 (요약, 자세한 명령은 tech/07 2장)**
1. AWS 계정(루트 MFA·결제 알림), IAM Identity Center 관리자, AWS CLI·Session Manager 플러그인
2. `cdk bootstrap` → `Berun-{Stage}-Base` 배포
3. KMS 데이터 키 만들기(`generate-data-key-without-plaintext`) → JWT 키 만들기 → Secrets Manager `berun-{stage}/app` 만들기
4. 도메인·ACM 인증서(서울 리전) → 이미지 빌드·ECR push(arm64)
5. `Berun-{Stage}-App` 배포(이미지 태그·인증서·허용 IP) → 마이그레이션 작업 실행 → DNS 연결 → `/health` 확인
6. ECS Exec으로 첫 owner 만들기 → 관리자 웹 로그인 확인
7. staging에서 한 번 끝까지 해 본 뒤 prod

**보드 갱신 요청**: T-029 → `검토` (또는 병합 후 `완료`).

**다음 작업 제안**
1. 운영 경보: CloudWatch 경보(ALB 5xx·RDS CPU·작업 재시작) + SNS, WAF 로그
2. 저장 암호화 데이터 키 교체용 재암호화 일회성 작업
3. 배포 자동화(GitHub OIDC 역할로 이미지 push·`cdk deploy`) — 사용자가 수동 배포를 몇 번 해 본 뒤 승인하면
