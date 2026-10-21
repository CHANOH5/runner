# 기술 결정 D-005 ~ D-008 의견서 (T-015)

- From: developer
- To: orchestrator
- 종류: 결정 요청
- 관련 ID: D-005, D-006, D-007, D-008, T-012, T-015, F-012, F-040~F-046, P-LOC-04, P-LOC-12
- 상태: 종료

## 요약

| ID | 권장안 | 지금 확정? |
|---|---|---|
| D-005 | **Expo(React Native, TS) + Development Build** (Expo Go 사용 안 함) | **지금 확정** |
| D-006 | **PostgreSQL 16 + PostGIS (RDS)** | **지금 확정** |
| D-007 | 방향만 확정: **업로드 = HTTPS 배치, 시청 = WebSocket으로 시작**. MQTT 전환 여부는 PoC·부하 테스트 후 | **미룸** (Phase 2 종료 전, 늦어도 Phase 3 개발 착수 전) |
| D-008 | **네이버 지도** (`@mj-studio/react-native-naver-map`), 지도 컴포넌트는 앱 내부 래퍼로 감싸 교체 가능하게 | **Phase 1 개발 착수 전 확정**. 단, NCP 콘솔에서 새 Maps 요금 확인 1건 선행 |

---

## D-005 앱: Expo (React Native, TypeScript)

- **권장**: 확정. Expo Go가 아니라 **Development Build(EAS Build)** 로 개발한다.
- **근거**
  - 1인 개발로 iOS·Android 동시 출시, 서버와 TypeScript·Zod 스키마 공유 (`02-tech-stack.md`).
  - 후보 지도 SDK 둘 다 Expo에서 **config plugin + Development Build**로 동작한다 (D-008 참고). 네이버 지도 RN 라이브러리는 "Bare, CNG 지원, Expo Go 미지원"이라고 명시 [확인].
  - EAS Update로 JS 변경을 스토어 심사 없이 배포 가능 (`01-environment.md`).
- **위험**
  - 백그라운드 위치(Phase 3)의 안정성, 특히 Android 제조사 배터리 최적화. → Phase 3 전 10km 실주행 PoC (기존 계획 유지). 실패 시 `react-native-background-geolocation`(유료) 또는 네이티브 모듈. 이 위험은 Phase 1 범위(캘린더·등록·예측)에는 영향 없음.
  - 서드파티 네이티브 라이브러리의 New Architecture 대응 지연. 네이버 지도 RN 라이브러리는 New Architecture(RN 0.74+) 전제 [확인], 최신 2.9.1 (2026-10-07 배포) [확인].
- **확정 시점**: 지금. Phase 1 코드 착수의 전제.

## D-006 DB: PostgreSQL + PostGIS

- **권장**: 확정 (PostgreSQL 16 이상, Amazon RDS, PostGIS 확장).
- **근거**
  - Phase 1에도 공간 데이터가 있다: `races.venue_point`(대회장 위치), 지역·거리 기반 대회 검색.
  - Phase 3의 핵심 정책 강제(P-LOC-04 코스 반경, P-LOC-12 좌표 → 구간 변환)를 `ST_LineLocatePoint`, `ST_DWithin`으로 서버에서 처리 (`03-architecture.md`).
  - 관계형 데이터(대회-종목-등록-예측)가 대부분이고, 동의·확인자료 이력처럼 무결성이 중요한 데이터가 많음.
- **위험**: 낮음. Drizzle ORM은 PostGIS 타입 지원이 약해 공간 쿼리는 raw SQL 혼용 (이미 계획됨). `location_points` 대량 쓰기는 Phase 3에서 파티션·배치 적재로 대응.
- **확정 시점**: 지금. T-011(API 명세)과 마이그레이션 작성의 전제.

## D-007 실시간 위치 전송: MQTT(AWS IoT Core) vs WebSocket

- **권장**: **지금 확정하지 않는다.** 대신 방향을 기록해 둔다.
  - 러너 → 서버 **업로드는 HTTPS 배치 전송** (오프라인 버퍼와 궁합, 서버에서 P-LOC 정책 강제 용이). 이 부분은 지금 확정해도 됨.
  - 서버 → 시청자 **구독은 WebSocket(Fastify + Redis Pub/Sub)으로 시작**, 대회 당일 동시접속 부하 테스트 결과에 따라 MQTT(AWS IoT Core) 전환 검토.
- **근거**
  - Phase 1·2에는 실시간 기능이 없다 (D-002). 지금 정해도 얻는 것이 없다.
  - 권한 로직(정확 위치 vs 대략 구간 채널, 차단, 즉시 중지)을 한 서버에 모으면 정책 강제와 감사 로그(P-LOC-43) 구현이 단순해진다. MQTT는 토픽 권한(IoT 정책)으로 같은 규칙을 다시 표현해야 한다.
  - 응원 웹(W-001)은 브라우저라 WebSocket이 자연스럽다 (MQTT도 WebSocket 위에서 가능하나 구성 추가).
- **위험**
  - WebSocket은 대회 당일 순간 확장을 직접 해야 한다 (ECS 오토스케일, 연결 수 기반). 시청자 = 공유자 × 3~5 가정 시 1만 명 대회에서 동시 연결 수천 개 수준 → 단일 리전 ECS로 감당 가능 [추정, 부하 테스트로 확인].
  - AWS IoT Core 요금(연결 분·메시지 수)은 이번에 확인하지 않음 `[확인 필요]`.
- **확정 시점**: Phase 2 종료 전, 백그라운드 위치 PoC와 부하 테스트(k6 등) 결과를 붙여 다시 요청.

## D-008 지도 SDK: 네이버 지도 vs Google Maps

### 확인한 사실 (조사일 2026-10-21)

| 항목 | 네이버 지도 | Google Maps |
|---|---|---|
| Expo 연동 | `@mj-studio/react-native-naver-map` 2.9.1 (2026-10-07), Expo config plugin, **Development Build 필요, Expo Go 미지원**, New Architecture 전제 [확인]. 2.4.x부터 **새 NCP Maps 단독 상품** 키 사용 [확인] | `react-native-maps`(iOS·Android 모두 Google 가능) 또는 `expo-maps`. 단 **`expo-maps`는 iOS에서 Apple Maps만**, Google은 Android 전용. 최신 문서(SDK 58) 기준 iOS 17 이상 요구 [확인] |
| 모바일 지도 비용 | 구 AI NAVER API 지도: 2025-07-01부로 무료 이용량 종료, Mobile Dynamic Map 0.1원/건으로 공지 [확인]. **새 Maps 상품의 Mobile Dynamic Map 무료량·단가는 공개 문서에서 확인 못 함** `[확인 필요]` (NCP 콘솔 요금 안내 확인). 호출 한도 문서상 Dynamic Map 일 기본 600만 회 [확인] | **Mobile Native Dynamic Maps는 $0, 무제한** (Maps SDK for Android/iOS 공식 문서) [확인]. Geocoding·Places 등은 별도 과금 |
| 국내 지도 품질 | 국내 도로·보행로·공원길 상세, 국내 사용자 친숙 [추정·일반적 평가] | 정부가 2026-02-27 1:5000 고정밀 지도 반출을 **조건부 허가** (보안시설 처리, 좌표 표시 제한, 국내 서버). 실제 국내 지도 품질 개선 시점은 확인 못 함 [확인/미확인 구분] |
| 참고 | 마라톤온라인 등 국내 대회 사이트도 네이버 지도 사용 [확인] | — |

### 비용 추정 (네이버, 단가 0.1원/건을 가정한 상한) [추정]
- Phase 1 지도 사용: 대회 상세(F-012)의 대회장 위치·코스 지도 정도. DAU 1천~1만 × 하루 지도 로드 3회 × 30일 = 9만~90만 건/월 → **약 9천~9만 원/월**.
- Phase 3 라이브(러너 화면 + 시청자 화면)는 로드 수가 크게 늘 수 있음 → 그때 다시 계산. 응원 웹(W-001)은 Web Dynamic Map 별도 과금 `[확인 필요]`.

### 권장
- **네이버 지도로 확정**하되, 앱에서 지도는 `MapView` 래퍼 컴포넌트 하나로만 사용해 SDK 교체 비용을 낮춘다.
- **근거**: 서비스가 국내 대회 전용이고, 러너가 보는 코스·대회장 주변 보행 정보의 품질이 핵심. 비용은 Phase 1 규모에서 월 수만 원 수준(상한 추정)으로 감당 가능. Expo 호환성은 두 후보 모두 Development Build 전제로 동등.
- **위험과 대응**
  - 새 Maps 요금 불확실 → **확정 전에 NCP 콘솔에서 Maps 요금(무료량·단가) 확인**. 단가가 위 가정보다 10배 이상이면 Google로 재검토.
  - 커뮤니티 라이브러리(1인 메인테이너) 의존 → 래퍼로 격리, 업데이트 중단 시 포크 가능(MIT).
  - Google의 국내 지도 품질이 고정밀 지도 반출로 개선되면 비용 이점($0) 때문에 재검토 가치 있음 → Phase 3 전 재점검.
- **확정 시점**: Phase 1 앱 개발 착수 전 (D-008 원래 조건 유지). 요금 확인 결과를 이 문서 답변에 첨부하면 바로 확정 가능.

---

## 기타 전달
- **파일 번호 충돌**: board의 T-011 산출물이 `tech/05-api.md`, T-012 산출물이 `tech/05-race-data-sourcing.md`로 둘 다 05번이다. T-012는 `05-race-data-sourcing.md`로 이미 작성했으니 T-011을 `tech/06-api.md`로 바꾸는 것을 제안.
- T-012 결과 `tech/05-race-data-sourcing.md`와 `tech/04-db-schema.md` 변경(대회 테이블 컬럼 추가, `race_candidates` 신규), 기획 결정 요청 `handoff/20261021-developer-planner-race-data-scope.md` 검토 부탁. decisions.md "미결 질문 — 대회 데이터 수집 방식"의 답변 후보: "공식 홈페이지 기준 관리자 입력 + 변경 감지 수집기(검수 후 반영) + 주최사 셀프 등록. 집계·경쟁 서비스 DB는 복제하지 않는다."

## 출처
- React Native Naver Map 문서: https://rnnavermap.mjstudio.net/en/docs , 저장소: https://github.com/mym0404/react-native-naver-map , npm: https://www.npmjs.com/package/@mj-studio/react-native-naver-map
- NCP 공지 "AI NAVER API 지도 API 무료 이용량 제공 종료 안내"(2025-05-28, 수정 2025-06-23): https://www.gov-ncloud.com/support/notice/all/528
- NCP 공지 "AI NAVER API 지도 API 신규 이용 신청 차단 및 무료 이용량 제공 중단 예정"(2025-03-24): https://www.ncloud.com/support/notice/all/1930
- NCP Maps 개요: https://guide.ncloud-docs.com/docs/maps-overview , 이용 한도: https://guide.ncloud-docs.com/docs/application-maps-spec
- Google Maps SDK for iOS 사용량·결제: https://developers.google.com/maps/documentation/ios-sdk/usage-and-billing
- Google Maps SDK for Android 사용량·결제: https://developers.google.com/maps/documentation/android-sdk/usage-and-billing
- Google Maps Platform 2025년 3월 변경사항: https://developers.google.com/maps/billing-and-pricing/march-2025
- Expo Maps 문서(최신, SDK 58): https://docs.expo.dev/versions/latest/sdk/maps/ , SDK 54: https://docs.expo.dev/versions/v54.0.0/sdk/maps/
- react-native-maps (Expo 문서): https://docs.expo.dev/versions/latest/sdk/map-view/
- 고정밀 지도 반출 결정 유보(2025-08): https://www.ddaily.co.kr/page/view/2025080817554908059
- 고정밀 지도 조건부 반출 허가(2026-02-27): https://www.khan.co.kr/article/202602271516001/

## 답변 (받는 쪽이 작성)
- (orchestrator, 2026-10-21) D-005·D-006 확정. D-007은 업로드 HTTPS 배치만 확정하고 시청 방식은 Phase 2 종료 전 재요청. D-008은 사용자 결정으로 **Phase 1에 지도 포함, 네이버 지도 + 래퍼**로 조건부 확정(NCP 요금 확인은 사용자). T-011 산출물은 `tech/06-api.md`로 변경. 대회 데이터 방식은 D-013으로 기록.
