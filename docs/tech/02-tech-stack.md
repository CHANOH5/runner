# 02. 기술 스택

- 담당: 개발자
- 상태: v1 초안 — 결정 D-005 ~ D-008은 `decisions.md`에서 확정 대기
- 관련: `01-environment.md`, `03-architecture.md`

선정 기준: **1인 개발 속도**, **기존 경험(Node.js, AWS, MQTT) 활용**, **백그라운드 위치의 안정성**

---

## 1. 요약

| 영역 | 선택 | 대안 | 결정 |
|---|---|---|---|
| 앱 | **Expo (React Native) + TypeScript** | Flutter, 네이티브(Swift/Kotlin) | D-005 제안 |
| 앱 라우팅 | Expo Router | React Navigation | |
| 앱 상태·서버 데이터 | TanStack Query + Zustand | Redux Toolkit | |
| 앱 UI | 자체 디자인 시스템 + `react-native-reanimated` | Tamagui, NativeWind | [미정] |
| 지도 | **네이버 지도** vs Google Maps | Kakao 지도, Mapbox | D-008 제안 |
| 위치 | `expo-location` + `expo-task-manager` (백그라운드) | `react-native-background-geolocation` (유료, 더 안정적) | 실측 후 결정 |
| 로그인 | 카카오, Apple, Google 네이티브 SDK | | |
| 푸시 | Expo Notifications (FCM / APNs) | 직접 FCM | |
| 서버 | **Node.js 22 + TypeScript + Fastify** | NestJS, Express | |
| ORM / 쿼리 | **Drizzle ORM** (PostGIS는 raw SQL 혼용) | Prisma, Kysely | |
| 검증 | Zod (앱·서버 스키마 공유) | | |
| DB | **PostgreSQL 16 + PostGIS** (Amazon RDS) | | D-006 제안 |
| 캐시·실시간 상태 | Redis (ElastiCache) | | |
| 실시간 위치 전송 | **MQTT (AWS IoT Core)** vs WebSocket (Fastify + Redis Pub/Sub) | Ably, Pusher | D-007 제안 |
| 작업 큐 | BullMQ (Redis) | SQS | |
| 파일 저장 | S3 + CloudFront (배번 사진은 비공개 버킷, 서명 URL) | | |
| 응원 웹 · 관리자 웹 | Next.js | Vite + React | |
| 대회 데이터 수집 | 관리자 입력 + 변경 감지 수집기(`undici`+`cheerio`, 필요한 사이트만 Playwright) → 검수 대기열 | 주최사 셀프 등록·제휴 | T-012, `05-race-data-sourcing.md` |
| 기록 예측 | 서버 TypeScript 모듈 (Riegel + 보정) → 이후 Python 모델 | | D-004 |
| AI 설명 생성 | Claude API (Phase 4) | | |
| 인프라 코드 | AWS CDK (TypeScript) | Terraform | |
| CI/CD | GitHub Actions, EAS Build / EAS Update | | |
| 모니터링 | Sentry (앱·서버), CloudWatch | Datadog | |
| 제품 분석 | Amplitude 또는 PostHog | Firebase Analytics | [미정] |

## 2. 주요 선택 이유

### Expo (React Native)
- iOS와 Android를 코드 하나로 만든다. TypeScript를 서버와 공유한다 (Zod 스키마, 타입).
- Development Build로 네이티브 모듈(지도 SDK, 백그라운드 위치)을 쓸 수 있다.
- **위험**: 백그라운드 위치의 안정성. 특히 Android 제조사별 배터리 최적화(삼성 등)가 앱을 종료시킬 수 있다.
  → Phase 3 전에 **기술 검증(PoC)** 을 한다. 실제로 10km를 뛰면서 화면 꺼짐·잠금 상태의 전송 성공률을 측정한다. 기준에 못 미치면 `react-native-background-geolocation` 라이선스를 구매하거나 네이티브 모듈을 직접 작성한다.

### PostgreSQL + PostGIS
- 대회 코스(LineString), 결승선 반경, 좌표 → 코스 거리 변환(`ST_LineLocatePoint`)을 DB에서 처리한다.
- P-LOC-12(참가자에게는 좌표 대신 구간만 노출)를 서버에서 계산하는 핵심 기능이다.

### 실시간: MQTT vs WebSocket (D-007)
| | MQTT (AWS IoT Core) | WebSocket (자체 서버) |
|---|---|---|
| 장점 | 불안정한 모바일 네트워크에 강함(QoS, 재연결), 서버 관리 부담 적음, 기존 경험 | 구조 단순, 권한 로직을 한곳에서 처리, 비용 예측 쉬움 |
| 단점 | 토픽 권한 설계 필요(P-LOC 강제), 비용 모델 확인 필요 | 대회 당일 순간 확장 직접 대응 |
| 권장 | 러너 → 서버 **업로드는 HTTPS 배치 전송**으로 단순화하고, 서버 → 시청자 **구독**에 MQTT 또는 WebSocket 사용 | |

> 권장안: **업로드는 HTTPS 배치**(오프라인 버퍼와 궁합이 좋고 서버에서 정책을 강제하기 쉬움), **시청은 WebSocket**으로 시작하고, 부하 테스트 결과에 따라 MQTT로 전환을 검토한다.

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
