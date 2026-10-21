# 대회장 지도·관리자 빠른 입력 기술 확인 (PRD v1.1)

- From: planner
- To: developer
- 종류: 질문
- 관련 ID: D-008, D-014, F-012, S-022, A-003, `races`
- 상태: 답변됨

## 내용

`docs/planning/05-prd-phase1.md` v1.1에서 D-008(Phase 1 대회장 지도)과 D-014(사용자 1인이 관리자 웹으로 직접 입력)를 반영했다. 지난 handoff 답변(`20261021-planner-developer-phase1-prd-questions.md`)의 요청 6개도 05 문서에 반영했다 (2.2, 4.1, 4.8, 4.10, 4.15, 7.1, 7.3, 8.4).

새로 확인할 것:

1. **미니 지도·전체 화면 지도 (05 문서 4.7)** — 미니 지도는 제스처 끄고, 화면에 들어올 때 지연 로딩, 현재 위치 버튼·위치 권한 없음. 네이버 지도 RN 라이브러리로 ① 제스처 비활성 ② 위치 추적 UI 끄기 ③ 야간(다크) 스타일이 되는지, ④ 과금 단위가 "지도 로드 1회"인지(전체 화면 진입 시 또 과금되는지) 알려 달라. (05 Q-16)
2. **[길찾기] 외부 지도 앱 (4.7)** — 네이버 지도 / 카카오맵 / Apple 지도 / Google 지도를 대회장 좌표 도착지로 여는 URL 스킴, 설치된 앱만 시트에 보여주기 위한 설정(iOS `LSApplicationQueriesSchemes`, Android 패키지 가시성 `<queries>`), 실패 시 네이버 지도 모바일 웹 대체. (05 Q-17)
3. **관리자 웹 지도 핀 조정 (8.4.2)** — 지오코딩 결과를 관리자 폼 옆 작은 지도(NCP 웹 지도)에서 핀을 끌어 고치는 것. 어려우면 좌표 붙여넣기만으로도 된다.
4. **복제 입력 (8.4.4)** — 복제 원본 기록용으로 `races.cloned_from` 컬럼 또는 감사 로그 기록 중 편한 쪽. 날짜 +1년(같은 요일에 가장 가까운 날짜), 대회명 연도·회차 자동 변경 규칙은 05 문서 8.4.4.
5. **빠른 입력 (8.4.1)** — 초안 저장 필수값은 대회명·대회일·지역 3개뿐이고 게시할 때 나머지를 검사한다. 현재 스키마(`race_events`가 없는 초안, `official_url` null, `last_verified_at NOT NULL`)와 맞지 않는 제약이 있으면 알려 달라. 기획 제안: 초안은 `last_verified_at`을 저장 시각으로 자동 채움.

## 기대하는 결과물 / 답변 형식
항목별 "가능 / 조건부(조건) / 불가(대안)" 한 줄. 스키마가 바뀌면 `tech/04` 변경 이력에 남기고 이름만 알려 달라.

## 답변 (받는 쪽이 작성)

(developer, 2026-10-21 — 라이브러리는 `@mj-studio/react-native-naver-map` 2.9.1 소스로 확인. 스키마 변경은 `tech/04-db-schema.md` 변경 이력, API는 `tech/06-api.md`)

### 1. 미니 지도·전체 화면 지도 (Q-16)
| 항목 | 답 | 근거 |
|---|---|---|
| ① 제스처 비활성 | **가능** | `isScrollGesturesEnabled` / `isZoomGesturesEnabled` / `isTiltGesturesEnabled` / `isRotateGesturesEnabled` = false. 미니 지도 탭은 지도 위에 투명 `Pressable`을 덮어 받는다 |
| ② 위치 추적 UI 끄기 | **가능** | `isShowLocationButton` = false(기본값도 꺼짐), 위치 오버레이를 켜지 않으면 위치 권한을 요청하지 않는다. 나침반·줌 버튼도 `isShowCompass`, `isShowZoomControls`로 끈다 |
| ③ 야간(다크) 스타일 | **조건부** | SDK의 `isNightModeEnabled`는 **Navi(내비게이션) 지도 유형에서만** 동작한다고 명시되어 있다 → 일반(Basic) 지도에는 효과 없음 [확인]. 대안: 새 NCP Maps의 **커스텀 스타일**(`customStyleId`, 네이버 스타일 에디터)로 어두운 스타일을 만들어 다크 모드에서 적용 [추가 비용 여부 `[확인 필요]`]. 그 전까지는 **다크 모드에서도 밝은 지도**를 보여준다 |
| ④ 과금 단위 | **조건부 (추정)** | 공식 문서에서 "지도 로드 1회" 정의를 찾지 못했다. 일반적으로 **지도 객체가 생성될 때 1회**로 집계되는 것으로 알려져 있다 [추정]. 전체 화면 지도는 **별도 지도 객체**이므로 **진입할 때마다 1회 더** 집계된다고 보고 비용을 잡는다. 개발 중 NCP 콘솔 이용량으로 실측해 확정한다. 지도 이동·확대는 추가 과금이 아닌 것으로 본다 [추정] |

→ **기획 수정 필요 (4.7)**: "다크 모드에서는 지도도 야간 스타일 (SDK가 지원하면)"을 **"Phase 1은 다크 모드에서도 기본(밝은) 지도. 커스텀 다크 스타일은 비용 확인 후 적용"** 으로 바꿔 달라. Q-16 종료 가능.

### 2. [길찾기] 외부 지도 앱 (Q-17) — **가능**
| 앱 | 여는 URL (대회장 좌표 도착지, 도보) | 좌표 없을 때 (검색) | 설치 확인 |
|---|---|---|---|
| 네이버 지도 | `nmap://route/walk?dlat={lat}&dlng={lng}&dname={장소명}&appname={번들ID}` [확인: NCP URL Scheme 가이드, `appname` 필수] | `nmap://search?query={검색어}&appname=…` [확인] | iOS `nmap` / Android `com.nhn.android.nmap` |
| 카카오맵 | `kakaomap://route?ep={lat},{lng}&by=FOOT` [추정: 2차 출처, 구현 시 실기기 확인] | `kakaomap://search?q={검색어}` [추정] | iOS `kakaomap` / Android `net.daum.android.map` [추정] |
| Apple 지도 (iOS) | `https://maps.apple.com/?daddr={lat},{lng}&dirflg=w` | `https://maps.apple.com/?q={검색어}` | 기본 앱, 확인 불필요 |
| Google 지도 (Android) | `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=walking` | `https://www.google.com/maps/search/?api=1&query={검색어}` | 기본 앱, 확인 불필요 |

- 설치된 앱만 보여주기: iOS는 `Info.plist`의 `LSApplicationQueriesSchemes`에 `nmap`, `kakaomap` 등록 (Expo `ios.infoPlist`), Android 11+는 `<queries>`에 두 패키지 등록 (작은 Expo config plugin 직접 작성) 후 `Linking.canOpenURL`로 확인.
- 실패 시 대체: 네이버 지도 **모바일 웹 검색**을 인앱 브라우저로 연다 (장소명 또는 주소로 검색). 웹은 좌표 길찾기 URL 형식이 문서화돼 있지 않아 검색으로 대체한다.
- 국내에서 Google 지도는 도보 길찾기를 제공하지 않을 수 있다 → Google은 `travelmode=transit`로 열고, 안 되면 사용자가 앱에서 바꾼다 [추정].
- 기획 변경 없음. 단, 도착지 이름은 `dname`/검색어 모두 **장소명**(없으면 주소)으로 통일.

### 3. 관리자 웹 지도 핀 조정 — **가능**
- NCP **Web Dynamic Map**(JS SDK)의 마커는 `draggable` 옵션으로 끌 수 있고, 끌기가 끝나면 좌표를 폼에 넣는다. 지오코딩 결과 선택 → 지도 이동 → 핀 미세 조정 → 저장.
- Web Dynamic Map은 모바일과 **별도 과금 상품**이지만 관리자 1인 사용이라 월 수백 회 수준 [추정]. 같은 NCP Application 키에 Web 서비스 URL(`admin` 도메인)을 등록해야 한다 (도메인 미정 — Q-12 대기).
- 좌표 붙여넣기(`37.5665, 126.9780`)도 함께 둔다.

### 4. 복제 입력 — **가능, `races.cloned_from` 컬럼 추가 + 감사 로그 둘 다**
- `races.cloned_from uuid` (원본 삭제 시 null). 목록에서 "작년 대회" 링크, 복제 후 확인 안 된 날짜 강조에 쓴다.
- **날짜 규칙 단순화 제안**: "+1년, 같은 요일에 가장 가까운 날짜"는 윤년 포함 **항상 +364일(52주)** 과 같다 (365일·366일 모두 364일이 가장 가깝다). 예: 2026-11-08(일) → 2027-11-07(일) ✓. 05 문서 8.4.4에 "= +52주"를 병기해 달라.
- 대회명 연도·회차 변경: 대회명 안의 `20\d\d` 4자리를 새 연도로, `제(\d+)회`를 +1. 둘 다 여러 개면 첫 번째만 바꾸고 노란 배경 강조.
- 복제 시 `race_events`(종목)는 복사, `race_sources`는 **대표 출처의 URL만 복사하고 확인 일시는 비운다** (아래 5번).

### 5. 빠른 입력(초안) 스키마 제약 — **조건부: 스키마 2곳 변경 + 기획 문구 1곳 수정**
| 제약 | 문제 | 변경 |
|---|---|---|
| `races.last_verified_at NOT NULL` | 8.4.4 복제는 "최종 확인일 비움"인데 NOT NULL이라 저장 불가 | **nullable로 변경**. 게시 조건에서 필수 (DB CHECK: `published`면 NOT NULL) |
| `race_sources.fetched_at NOT NULL` | 복제 시 출처 확인 일시 비움과 충돌 | **nullable로 변경** (null = 아직 확인 안 함). 게시 조건: 대표 출처의 확인 일시가 있어야 함 |
| `official_url` null | 문제없음 (이미 nullable). 게시 조건으로만 검사 | — |
| `race_events` 0개인 초안 | 문제없음. 게시 조건으로만 검사 (서버) | — |
| `slug NOT NULL UNIQUE` | 자동 생성. 복제·동명 대회 충돌 시 `-2`, `-3` 접미사 자동 | — |
| `dedupe_key NOT NULL` | 대회명+대회일로 서버가 계산 → 초안 필수값으로 충분 | — |

- 기획 제안 "초안은 `last_verified_at`을 저장 시각으로 자동 채움"은 **신규 작성에만 적용**하고 **복제 초안에는 적용하지 않는다** (8.4.4 "게시 전에 반드시 확인"과 충돌하므로). 즉: 신규 저장 = 지금으로 자동, 복제 = 비움 → 게시 전 [확인 완료] 필수.
- 게시 조건 검사는 서버가 한다: `POST /admin/races/{id}/publish`가 미충족 항목 코드 목록을 돌려준다 (`tech/06-api.md` A-003).

→ **기획 수정 필요 (8.4.2 최종 확인일 행)**: "신규 저장 시 오늘"을 "신규 작성 시 오늘, **복제 초안은 비움** (게시 전 [확인 완료] 필수)"로 명확히 해 달라. 8.4.4와 문구를 맞추는 정도다.

### 추가 (API 명세 작성 중 발견)
- **4.6 참가비 필터 경계값**이 정해져 있지 않다 (3만 원은 "3만 원 이하"인가 "3~5만 원"인가). `tech/06-api.md`는 ≤30,000 / 30,001~50,000 / 50,001~100,000 / >100,000으로 썼다. 맞으면 4.6에 명시해 달라.
- PRD 변경 대기 4건은 `tech/06-api.md` 11장에 모아 두었다.

출처: 라이브러리 소스 `@mj-studio/react-native-naver-map@2.9.1` `src/component/NaverMapView.tsx` (https://github.com/mym0404/react-native-naver-map) · NCP Maps URL Scheme https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc · 카카오맵 스킴(2차 출처) https://dev.to/piyaklabs/routing-around-google-maps-in-korea-naver-kakao-deep-links-weird-coordinates-and-ios-clipboard-25mf · NCP Maps 이용 가이드 https://guide.ncloud-docs.com/docs/maps-app
