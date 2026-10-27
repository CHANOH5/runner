# T-029 운영 배포 준비 완료 (D-022 재작업 반영) — 검토·병합 요청, 결정 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청, 결정 요청 5건)
- 관련 ID: T-029, D-022, D-006, P-RET-02, PRD Q-12, tech/07
- 상태: 열림

## 내용

브랜치 `claude/infra-t029`에 T-029와 D-022 재작업을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**AWS 리소스는 하나도 만들지 않았다.** `cdk deploy`·`bootstrap`·이미지 push를 하지 않았고 AWS 자격 증명도 쓰지 않았다. 배포는 사용자가 `docs/tech/07-deploy.md` 3장 순서로 직접 한다.

**운영 구성 (D-022): 서버 1대**
- 추천: **EC2 t4g.small**(2GB, ARM, 서울) + Docker Compose. 비교표는 tech/07 1.1이다.
  - Lightsail 2GB(약 $12)가 월 약 $10 싸지만 IAM 역할을 붙일 수 없다. 그러면 KMS·S3용 액세스 키를 서버에 둬야 한다.
  - EC2는 인스턴스 역할을 쓰므로 서버에 키가 없다. 나중에 RDS·ALB도 같은 VPC에 붙는다.
- `deploy/compose.prod.yml` 구성:
  - 컨테이너: API, 워커, 관리자 웹, PostgreSQL 16 + PostGIS, Redis(noeviction, AOF), Caddy(자동 HTTPS)
  - 메모리 한도 합계 1.6GB (예산은 tech/07 1.3)
  - DB·Redis는 호스트에 포트를 열지 않는다.
  - 마이그레이션은 일회성 서비스로 돌린다. 이미지는 기존 Dockerfile을 그대로 쓴다.
- 관리자 접근 — 공개 인터넷에 열지 않는다.
  - 기본은 **SSM 포트 포워딩 터널**(`127.0.0.1:8081`)이다. SSH 포트를 열지 않고 AWS 로그인(MFA)이 필요하다.
  - 고정 IP가 있으면 Caddy 허용 IP 목록을 쓴다. 비어 있으면 관리자 호스트는 전부 403이다.
  - 같은 출처 구조라 세션 쿠키(SameSite=Strict)와 CSRF는 그대로다. 앱 호스트의 `/api/admin`은 404다.
- 백업:
  - 매일 04:30 KST에 `pg_dump`를 하고, 덤프가 손상되지 않았는지 확인한 뒤 S3에 올린다.
  - 버킷은 SSE-S3 암호화, TLS 전용, 공개 차단이고 **35일 뒤 자동 삭제**한다(P-RET-02).
  - 서버는 올리기와 읽기만 할 수 있고 지울 수 없다.
  - 복구 스크립트와 복구 리허설 스크립트가 있다. 리허설은 운영 DB를 건드리지 않는다.
  - EBS 일일 스냅숏은 선택 사항이다(7개 보관, +약 $1~2).
- KMS: 토큰 키 봉투 암호화를 그대로 쓴다. 키 1개, 약 $1. 서버는 인스턴스 역할로 Decrypt만 하고, 암호화 컨텍스트 조건을 둔다. 서버 코드는 바꾸지 않았다.
- staging: 상시 환경은 없다. 대신 `deploy/scripts/local-check.sh`를 쓴다. 운영 이미지와 compose를 로컬에서 그대로 띄워 8개 항목을 점검하고 정리한다. 실기기 확인이 필요하면 임시 서버를 띄운다.
- CDK:
  - 새 스택 `Berun-Single`: EC2, 고정 IP, 보안 그룹(80·443만), 인스턴스 역할, KMS 토큰 키, ECR 2개, 백업 버킷, 하드웨어 장애 자동 복구 경보.
  - 1차안 `Berun-{Staging,Prod}-Base/App`(ECS·RDS·ALB·NAT)은 **확장 단계로 보관**한다. 지우지 않았고 CI synth와 스냅숏 테스트는 그대로 유지한다.
- `docs/tech/07-deploy.md`를 다시 썼다. 내용:
  - 구성 그림
  - 서버 비교표와 메모리 예산
  - 항목별 월 비용
  - 사용자 단계 0~8
  - 관리자 접근
  - 배포·롤백
  - 백업·복구
  - 로컬 확인
  - 확장 기준과 순서(단계별 비용 증가분)
- tech/01·02·03과 README도 함께 고쳤다.

**예상 월 비용 (추정, tech/07 2장)**
- EC2 추천안 **약 $23(약 3만 2천 원)**: 서버 $15.2, 디스크 $2.7, IPv4 $3.7, KMS $1, ECR·S3·경보 약 $0.5.
- Lightsail 2GB안은 약 $14다.
- 1차안(월 약 $430)의 약 1/18이다.
- 대신 받아들이는 것:
  - 서버 1대 장애는 곧 서비스 중단이다. 하드웨어 장애는 경보가 자동으로 복구한다.
  - 데이터 손실은 최대 24시간이다(매일 백업).
  - 배포할 때 수 초 끊긴다.

**확장 기준과 순서 (tech/07 9장)**
- 다음 신호가 1~2주 지속되면 다음 단계를 검토한다.
  - CPU 평균 60% 이상, 또는 CPU 크레딧이 자주 0
  - 가용 메모리 300MB 미만
  - DB 10GB 이상, 또는 복구 리허설 15분 초과
  - Redis 사용량이 한도의 70% 이상
- **Phase 3 라이브 시작 전에는 신호와 관계없이 ①②③을 마친다.**
- 순서와 비용 증가분:

| 단계 | 하는 일 | 월 비용 증가 |
|---|---|---|
| 0 | 서버를 t4g.medium으로 키우기 | +$15 |
| ① | DB를 RDS로 | +$21~43 |
| ② | Redis를 ElastiCache로 | +$15 |
| ③ | 서버 2대 + ALB + WAF | +약 $54 |
| ④ | CDK 확장 스택(Fargate·NAT)으로 전환 | 합계 약 $280 |

- ④로 갈 때는 KMS 토큰 키 `alias/berun-single-token`을 그대로 가져와야 한다. 그때 확장 스택이 기존 키를 받도록 고친다.

**확인**
- 실제 출력: `cdk synth` → 5개 스택 `Successfully synthesized`.
  - 경고는 확장 단계 스택의 의도한 것뿐이다(인증서 없음, 관리자 IP 없음).
  - `Berun-Single`에는 NAT·RDS·ElastiCache·ALB가 없다.
- 운영 compose 설정 검증: `docker compose config` 통과. 필수 값(DB·Redis 비밀번호 등)이 비면 실패하는 것도 확인했다. `caddy validate`와 shellcheck도 통과했다.
- **로컬에서 운영 compose를 띄워 확인했다** (`local-check.sh`, 8개 항목 통과):
  - API `/health`(HTTPS) 200, HTTP→HTTPS 308
  - 앱 호스트의 관리자 API 404
  - 관리자 호스트는 허용 IP가 비면 403이고, 허용하면 200
  - 터널 경로: 관리자 웹 200, 관리자 API 401
  - Postgres·Redis 호스트 포트 없음
  - 메모리 실측 합계는 유휴 상태에서 약 0.3GB다.
  - 처음 돌렸을 때 Caddy 지시어 순서 때문에 관리자 IP 차단이 적용되지 않았다. 고친 뒤 403을 확인했다.
- 복구 리허설: 로컬 운영 DB 덤프를 임시 DB에 복원했다(마이그레이션 8개, PostGIS 3.5). PostGIS 이미지가 미리 깐 확장과 충돌해서, 빈 `template0`에서 만든 DB에 복원하도록 고쳤다.
- 테스트: 서버 264, infra 26(Single 10 추가), 관리자 9, 앱 85. lint와 typecheck도 통과했다.
- CI: `deploy-config` 잡을 추가했다(compose config, caddy validate, shellcheck). 배포와 자격 증명은 없다.
- 공지 모듈은 건드리지 않았다.

**결정 요청**
1. **서버**: EC2 t4g.small(약 $23, 서버에 액세스 키 없음, 추천)과 Lightsail 2GB(약 $14, IAM 사용자 액세스 키 필요) 중 하나를 골라 달라.
2. **백업 주기(RPO)**: 매일 1회면 최대 24시간 분량을 잃을 수 있다. 6시간마다로 하면 추가 비용은 거의 없다. 기본값을 정해 달라.
3. **EBS 일일 스냅숏**(+약 $1~2): 켤지 정해 달라. 켜면 OS·설정까지 통째로 되돌릴 수 있다.
4. **도메인·관리자 접근 방식**(PRD Q-12 미결): 도메인은 첫 배포 전에 필요하다. 관리자 접근은 SSM 터널만 쓸지, 사무실 고정 IP도 허용할지 정해 달라.
5. **예산 승인과 첫 배포 시점**: Budgets 알림은 월 $40을 권장한다.

**사용자가 해야 할 일 (요약, 자세한 명령은 tech/07 3장)**
1. AWS 계정(루트 MFA, Budgets $40), IAM Identity Center 관리자, AWS CLI·Session Manager 플러그인, EC2 키 페어 `berun`
2. `cdk bootstrap` → `cdk deploy Berun-Single -c keyPairName=berun` → `~/.ssh/config`에 SSM 경유 SSH 설정
3. DNS A 레코드 `api.`·`admin.`을 고정 IP로 (AAAA는 만들지 않는다)
4. KMS 데이터 키(`generate-data-key-without-plaintext`), JWT 키, DB·Redis 비밀번호 만들기
5. `local-check.sh` → arm64 이미지 빌드 → ECR push
6. `deploy/`를 서버에 rsync → `.env`·`.env.app` 채우기(권한 600) → `scripts/deploy.sh <태그>` → `/health` 확인
7. 백업 타이머 켜기 → `backup.sh` 한 번 → `restore-rehearsal.sh` 한 번
8. `create-owner` CLI로 첫 owner → SSM 터널로 관리자 웹 로그인(Chrome)

**보드 갱신 요청**: T-029 → `검토` (또는 병합 후 `완료`). D-006의 "Amazon RDS"를 확장 단계로 미룬 것은 D-022에 이미 반영돼 있다.

**다음 작업 제안**
1. 운영 감시:
   - CloudWatch 에이전트(메모리·디스크) 경보
   - 백업 실패 알림(systemd `OnFailure` → SNS 또는 이메일)
   - 외부 `/health` 감시
2. 저장 암호화 데이터 키 교체용 재암호화 일회성 작업
3. 배포 자동화: GitHub OIDC 역할로 이미지 push, SSM Run Command로 `deploy.sh`. 수동 배포를 몇 번 해 본 뒤 진행한다.
