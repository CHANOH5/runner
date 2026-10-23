# 01. 서비스 환경

- 담당: 개발자
- 상태: v1 초안 (검토 대기)
- 관련: `02-tech-stack.md`, `03-architecture.md`

---

## 1. 클라이언트 환경

| 항목 | 지원 범위 | 비고 |
|---|---|---|
| iOS | iOS 16 이상 [미정] | iPhone만. iPad는 호환 모드 |
| Android | Android 10 (API 29) 이상 [미정] | Android 10부터 백그라운드 위치 권한이 따로 분리됨 |
| 언어 | 한국어 | 다국어는 이후 i18n 구조만 준비 |
| 화면 | 세로 고정 | 다크 모드 지원 |
| 웹 | 응원 웹 페이지 (W-001), 관리자 웹 | 모바일 브라우저 우선 |
| 웨어러블 | 미지원 (Phase 4 이후 Apple Watch, Galaxy Watch, Garmin 연동 검토) | |

### 기기 권한
| 권한 | 시점 | 단계 | 필수 여부 |
|---|---|---|---|
| 알림 | 온보딩 (S-006) | 1 | 선택 |
| 사진 / 카메라 | 배번 인증 시 (S-025) | 2 | 선택 |
| 위치 — 앱 사용 중 | 위치 공유 설정 (S-040) | 3 | 라이브에 필수 |
| 위치 — 항상 / 백그라운드 | 위치 공유 설정 (S-040) | 3 | 라이브에 필수 (화면 꺼짐 대응) |
| 동작 및 피트니스 | 검토 중 | 4 | 선택 |

> 권한은 **필요한 순간에** 요청한다. 앱을 처음 실행할 때 위치 권한을 요청하지 않는다.

## 2. 서버 환경

| 항목 | 내용 |
|---|---|
| 클라우드 | AWS 서울 리전 (ap-northeast-2) — 국내 사용자 지연 시간, 개인정보 국내 보관 |
| 환경 분리 | `local` / `dev` / `staging` / `prod` — prod 데이터는 다른 환경으로 복사하지 않는다 |
| 도메인 (가칭) | `api.berun.app`, `live.berun.app`(응원 웹), `admin.berun.app` [미정] |
| 배포 | 서버: GitHub Actions → ECS Fargate / 앱: EAS Build → TestFlight, Play 내부 테스트 |
| 앱 업데이트 | JS 변경은 EAS Update(OTA), 네이티브 변경은 스토어 배포 |

## 3. 트래픽 가정 (설계 기준)

| 상황 | 가정 | 설계 영향 |
|---|---|---|
| 평시 | DAU 1천~1만 | 일반 API 서버 1~2대 |
| 접수 오픈 시각 | 인기 대회 오픈 직전 알림 일괄 발송 → 순간 트래픽 급증 | 푸시를 큐로 분산 발송, 대회 상세 캐시 |
| **대회 당일 라이브** | 1만 명 대회에서 공유자 10%(1천 명) × 10초 간격 = 초당 100건 쓰기. 시청자는 공유자의 3~5배 | 위치 쓰기와 조회를 일반 API와 분리, Redis에 최신 위치만 유지 |
| 대회 현장 통신 | 참가자 밀집으로 LTE/5G 품질 저하 | 클라이언트 버퍼링, 배치 전송, 가벼운 페이로드 |

## 4. 위치 수집 파라미터 (초기값, 실측 후 조정)

| 항목 | 값 | 이유 |
|---|---|---|
| 수집 간격 | 5초 또는 10m 이동 | 페이스 계산 정확도 |
| 전송 간격 | 10~15초 (배치 전송) | 배터리, 통신량 |
| 정확도 | iOS `BestForNavigation`(러닝 중), Android `HIGH_ACCURACY` | 도심 빌딩 구간 오차 |
| 정확도 필터 | 수평 정확도 > 50m인 포인트는 제외 | 튐 방지 |
| 배터리 목표 | 풀코스(4~5시간) 동안 배터리 사용 40% 이하 | 실측으로 검증 |

## 5. 개발 환경

| 항목 | 내용 |
|---|---|
| 저장소 | 단일 모노레포 (`app/`, `server/`, `docs/`) |
| 패키지 매니저 | pnpm workspace |
| Node | 22 LTS |
| 로컬 DB | Docker Compose (PostgreSQL 16 + PostGIS 3.5 `imresamu/postgis:16-3.5` — arm64 지원, Redis 7). 호스트 포트 55432 / 56379, 테스트 DB `berun_test` |
| 브랜치 | `main` 보호, 기능은 `feat/*`, 세션별 워크트리 |
| 코드 규칙 | TypeScript strict (`noUncheckedIndexedAccess`), ESLint (typescript-eslint type-checked), Prettier |
| 테스트 | Vitest. 통합 테스트는 로컬 테스트 DB·Redis 사용 (README) |
| CI | GitHub Actions `.github/workflows/ci.yml` — push·PR마다 install → lint → typecheck → build → (PostGIS·Redis 서비스 컨테이너, 로컬과 같은 이미지·포트) 테스트 DB 생성 → migrate → seed → test. Node는 `.nvmrc`(22). 비밀값·배포·외부 호출 없음 |

---
## 변경 이력
- 2026-10-21: v1 초안 작성
- 2026-10-21: T-016 — 로컬 개발 환경 구체화 (Docker 이미지·포트·테스트 DB, 코드 규칙, 테스트)
- 2026-10-23: T-023 — CI 행 추가
