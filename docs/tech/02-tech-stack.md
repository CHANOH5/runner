# 02. 기술 스택

- 담당: 개발자
- 상태: v1.1 — D-005·D-006 확정, D-007 일부 확정, D-008 조건부 확정 (2026-10-21)
- 관련: `01-environment.md`, `03-architecture.md`

선정 기준: **1인 개발 속도**, **기존 경험(Node.js, AWS, MQTT) 활용**, **백그라운드 위치의 안정성**

---

## 1. 요약

| 영역 | 선택 | 대안 | 결정 |
|---|---|---|---|
| 앱 | **Expo (React Native) + TypeScript, Development Build** (Expo Go 미사용) | Flutter, 네이티브(Swift/Kotlin) | **D-005 확정** |
| 앱 라우팅 | Expo Router | React Navigation | |
| 앱 상태·서버 데이터 | TanStack Query + Zustand | Redux Toolkit | |
| 앱 UI | 자체 디자인 시스템 + `react-native-reanimated` | Tamagui, NativeWind | [미정] |
| 지도 | **네이버 지도** (`@mj-studio/react-native-naver-map`) — 앱 내부 `MapView` 래퍼로만 사용. Phase 1: 대회 상세의 대회장 위치 | Google Maps (`react-native-maps`) | **D-008 조건부 확정** (NCP 요금 확인 후 최종) |
| 지오코딩 (관리자) | NCP Maps Geocoding API (관리자 웹 서버에서 호출, 대회장 주소 → 좌표) | 수동 입력 | D-008과 함께 |
| 위치 | `expo-location` + `expo-task-manager` (백그라운드) | `react-native-background-geolocation` (유료, 더 안정적) | 실측 후 결정 |
| 로그인 | 카카오, Apple(iOS만), Google 네이티브 SDK. Android Apple 로그인은 Phase 1 제외 | | D-016 |
| 푸시 | Expo Notifications + Expo Push 서비스 (FCM / APNs). 한도: 프로젝트당 초당 600건 | 대회당 대상 10만 명 초과 시 FCM/APNs 직접 | |
| 서버 | **Node.js 22 + TypeScript + Fastify** | NestJS, Express | |
| ORM / 쿼리 | **Drizzle ORM** (PostGIS는 raw SQL 혼용) | Prisma, Kysely | |
| 검증 | Zod (앱·서버 스키마 공유) | | |
| DB | **PostgreSQL 16 + PostGIS** (Amazon RDS) | | **D-006 확정** |
| 캐시·실시간 상태 | Redis (ElastiCache) | | |
| 실시간 위치 전송 | 업로드: **HTTPS 배치 (확정)** / 시청: **WebSocket (Fastify + Redis Pub/Sub)로 시작**, MQTT(AWS IoT Core) 전환은 Phase 2 종료 전 결정 | Ably, Pusher | **D-007 일부 확정** (Phase 3) |
| 작업 큐 | BullMQ (Redis) | SQS | |
| 파일 저장 | S3 + CloudFront (배번 사진은 비공개 버킷, 서명 URL) | | |
| 응원 웹 · 관리자 웹 | Next.js | Vite + React | |
| 대회 데이터 수집 | 관리자 입력 + 변경 감지 수집기(`undici`+`cheerio`, 필요한 사이트만 Playwright) → 검수 대기열 | 주최사 셀프 등록·제휴 | T-012, `05-race-data-sourcing.md` |
| 기록 예측 | 서버 TypeScript 모듈 (Riegel + 보정) → 이후 Python 모델 | | D-004 |
| AI 설명 생성 | Claude API (Phase 4) | | |
| 인프라 코드 | AWS CDK (TypeScript) | Terraform | |
| CI/CD | GitHub Actions, EAS Build / EAS Update | | |
| 모니터링 | Sentry (앱·서버), CloudWatch | Datadog | |
| 제품 분석 | **PostHog 권장** (이벤트 과금, 자체 호스팅 이전 가능) | Amplitude, Firebase Analytics | [미정] — 오케스트레이터 결정 요청 |

## 2. 주요 선택 이유

### Expo (React Native) — D-005 확정
- iOS와 Android를 코드 하나로 만든다. TypeScript를 서버와 공유한다 (Zod 스키마, 타입).
- **Development Build(EAS Build)** 로 개발한다. 네이버 지도 SDK는 Expo Go에서 동작하지 않는다. 백그라운드 위치도 Expo Go에서는 제약이 있어 실기기 검증은 Development Build로 한다.
- **위험**: 백그라운드 위치의 안정성. 특히 Android 제조사별 배터리 최적화(삼성 등)가 앱을 종료시킬 수 있다.
  → Phase 3 전에 **기술 검증(PoC)** 을 한다. 실제로 10km를 뛰면서 화면 꺼짐·잠금 상태의 전송 성공률을 측정한다. 기준에 못 미치면 `react-native-background-geolocation` 라이선스를 구매하거나 네이티브 모듈을 직접 작성한다.

### PostgreSQL + PostGIS — D-006 확정
- 대회 코스(LineString), 결승선 반경, 좌표 → 코스 거리 변환(`ST_LineLocatePoint`)을 DB에서 처리한다.
- P-LOC-12(참가자에게는 좌표 대신 구간만 노출)를 서버에서 계산하는 핵심 기능이다.

### 지도: 네이버 지도 + `MapView` 래퍼 (D-008 조건부 확정)
- 국내 대회 전용 서비스라 대회장 주변 보행 정보 품질을 우선했다. Expo에서는 config plugin + Development Build로 동작한다 (Expo Go 미지원).
- 화면 코드는 네이버 SDK를 직접 import하지 않고 `app/src/components/map/`의 래퍼만 쓴다 (구조: `03-architecture.md` 6장). SDK를 Google로 바꿔도 래퍼 구현만 교체한다.
- **최종 확정 조건**: 사용자가 NCP 콘솔에서 새 Maps 요금(무료량·단가)을 확인. Mobile Dynamic Map 단가가 0.1원/건의 10배 이상이면 Google로 재검토 (D-008).
- 근거·비용 추정: handoff `20261021-developer-orchestrator-tech-decisions-d005-d008.md`.

### 실시간: 업로드 HTTPS 배치 + 시청 WebSocket (D-007 일부 확정)
| | MQTT (AWS IoT Core) | WebSocket (자체 서버) |
|---|---|---|
| 장점 | 불안정한 모바일 네트워크에 강함(QoS, 재연결), 서버 관리 부담 적음, 기존 경험 | 구조 단순, 권한 로직을 한곳에서 처리, 비용 예측 쉬움 |
| 단점 | 토픽 권한 설계 필요(P-LOC 강제), 비용 모델 확인 필요 | 대회 당일 순간 확장 직접 대응 |

- **확정**: 러너 → 서버 업로드는 **HTTPS 배치 전송** (오프라인 버퍼와 궁합, 서버에서 정책 강제 용이).
- **시작안**: 서버 → 시청자는 **WebSocket**. 백그라운드 위치 PoC와 부하 테스트 결과로 **Phase 2 종료 전** MQTT 전환 여부를 다시 결정 요청한다.

## 3. Claude Code 세션에서 쓸 도구 · 스킬

| 세션 | 주로 쓰는 것 |
|---|---|
| 오케스트레이터 | 문서 검토, `board.md` / `decisions.md` 관리 |
| 기획자 | 마크다운 문서, 와이어프레임(HTML 아티팩트), 경쟁 서비스 웹 조사 |
| 개발자 | 코드 작성, `/code-review`, `/security-review`(위치·개인정보 코드), iOS 시뮬레이터, 로컬 Docker |
| 마케터 | 웹 조사, 랜딩 페이지(HTML 아티팩트), 설문·인터뷰 문서 |

---
## 변경 이력
- 2026-10-21: v1 초안 작성
- 2026-10-21: 대회 데이터 수집 행을 T-012 권장안으로 수정
- 2026-10-21: D-005~D-008, D-016 반영 — 확정 표시, 지도 래퍼·지오코딩·푸시 한도 추가, 실시간 절 정리, 분석 도구 PostHog 권장
