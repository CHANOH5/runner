# app — BeRun 모바일 앱 (T-025)

Expo SDK 58 (React Native 0.88, React 19.3) + TypeScript strict + Expo Router + TanStack Query + Zustand (D-005, tech/02).
**Development Build**로 개발하고 Expo Go는 쓰지 않는다. 로컬 확인은 **Expo 웹(react-native-web)** 으로도 된다.

## 실행

```bash
pnpm dev:app                              # 루트: API :3000 + 앱 웹 :8081
pnpm --filter @berun/app dev              # 앱 웹만 (http://localhost:8081)
pnpm --filter @berun/app start            # Development Build(dev client)용 Metro
```

- 웹: 같은 출처 `/v1/*`를 Metro가 `BERUN_API_ORIGIN`(기본 `http://localhost:3000`)으로 넘긴다 (`metro.config.js`).
- 네이티브: `EXPO_PUBLIC_API_BASE_URL` (예: `http://192.168.0.10:3000/v1`). 없으면 `http://localhost:3000/v1`.
- 로그인: 개발 번들에서 로그인 화면 아래 **개발 전용 로그인** (서버 `DEV_LOGIN=true` 필요, 루트 README).

## 구조

```
src/
├── app/                Expo Router 화면 (파일 = 경로)
│   ├── index.tsx        S-001 스플래시 (app-config → refresh → /me)
│   ├── login · terms · profile-setup · underage · suspended · reconsent · reactivated
│   │   update-required · maintenance       S-002~S-004, 게이트 화면
│   ├── onboarding/      S-005 기록, S-006 알림 권한
│   ├── (tabs)/          하단 탭 4개 (D-012): home S-010 · races S-020 · records S-030 · my S-060
│   ├── notifications    S-011 (+ notices/[id] 공지 상세 — GET /notices/{id})
│   ├── races/           search·filter S-021, [raceId] S-022, [raceId]/register S-023, [raceId]/report S-024
│   ├── records/         edit S-031, predict S-032
│   ├── predictions/     목록, [predictionId] S-033 (저장된 예측, preview = S-023 미리보기)
│   ├── registrations/[registrationId]/strategy   S-033 (참가 예정 기준 페이스 전략)
│   └── my/              races S-061 · profile S-062 · settings S-063 · notification-settings S-064
│                        privacy S-065 · delete-account S-066
├── api/                client(토큰·갱신·게이트·에러) · endpoints(공유 Zod 스키마) · messages(코드 → 한국어) · tokens
├── features/           화면과 분리한 규칙: bootstrap · returnPrompt(복귀 질문) · prediction(S-033 상태) · race · goal
│                       recordForm · raceFilters · profile · auth · records · deepLink
├── components/         ui(디자인 기초) · map/MapView(D-008 래퍼, 지금은 자리 표시) · RaceCard · EntryStatusSheet …
├── lib/                format(KST·기록·페이스) · secureStore(.web) · push(.web) · kv · device · external · mapLinks · nav
├── stores/             session · toast · preview (Zustand)
└── theme/              라이트·다크 팔레트
```

- 웹 대체 구현은 같은 이름의 `.web.ts` 파일이다 (`secureStore.web.ts`, `push.web.ts`). Metro가 웹 번들에서 고른다.
- 지도 SDK는 `components/map/` 밖에서 import하지 않는다 (tech/03 6장).
- 날짜 입력(S-005·S-031)은 `components/DateField.tsx`(네이티브 달력 피커) / `DateField.web.tsx`(웹 미리보기 직접 입력) — PRD v1.11 4.4.

## 테스트

```bash
pnpm --filter @berun/app test            # jest-expo + React Native Testing Library
```

- 단위: API 클라이언트·토큰 갱신(`api/client.test.ts`), 에러 문구, 복귀 질문 규칙, 예측 화면 상태·표기, 부팅 판단, 목표·접수 상태 규칙, 기록 입력·필터·프로필 검증, 표기 규칙.
- 렌더: 로그인(개발 로그인), 약관, 홈, 대회 상세(출처·취소·내 참가 예정·410), 참가 예정 추가(접수 상태 기본값·요청 본문), 페이스 전략 3가지 상태 (`src/__tests__/screens.test.tsx` — 라우트 폴더 `src/app` 안에는 테스트를 두지 않는다: Expo Router가 화면으로 읽는다).
- 네이티브 모듈은 `jest.setup.ts`에서 대체한다.

## Development Build (아직 빌드하지 않음)

- `app.json`: bundle id·package `app.berun.dev` [미정 — 서비스명 D-009 확정 후], scheme `berun`, `expo-dev-client`, `expo-notifications`, iOS `LSApplicationQueriesSchemes`(nmap, kakaomap).
- `eas.json`: `development`(dev client, internal), `development-simulator`, `preview`, `production`.
- 아직 없는 것: EAS 프로젝트 id(푸시 토큰에 필요), Android 11+ 지도 앱 패키지 가시성 `<queries>` config plugin, 네이버 지도 config plugin(D-008), 소셜 로그인 SDK.
