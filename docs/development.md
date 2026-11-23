# 개발 문서 (Development)

> 이 문서는 **어떻게 만들어져 있고, 어떻게 고치는가**를 기록합니다.
> 마지막 갱신: 2026-11-23

## 1. 한눈에 보기
- 빌드 없는 정적 웹 + Vercel 서버 함수 1개. 프레임워크 없음(바닐라 JS).
- Node ≥ 18, ES Modules (`package.json`의 `"type": "module"`). 의존성은 `proj4` 하나(좌표 변환).

```
index.html     화면 뼈대(홈 + 5개 풀스크린 화면 + 카드 패널), 카카오 SDK 스크립트
style.css      전체 스타일 (디자인 토큰은 :root)
app.js         화면 로직 전체 (하나의 IIFE)
api/places.js  Vercel 함수: 잇플 데이터 수집·정리 → /api/places
docs/          기획·개발·디자인 문서
```

## 2. 데이터 흐름
```
브라우저 app.js ──fetch──▶ /api/places (Vercel 함수)
                              │ 도로명 14개를 병렬 호출
                              ▼
                     k-skill 프록시 (잇플/BC카드 데이터)
```
1. `loadPlaces()`가 `ROADS` 14개를 병렬로 조회 → `merUrl`로 중복 제거.
2. 필터: 여의도동만, 소매·마트 업종 제외, 구내식당(`CATERER`) 제외, 이름 정리(`cleanName`).
3. `normalize()`가 화면용 필드로 변환 (아래 3번).
4. 지역 매출 순위(`loc`) → 전국 순위(`nat`) 순 정렬. 인스턴스 메모리에 1시간 캐시(`MEMO_MS`), 응답은 CDN 6시간 캐시.
5. 실패 시 503/500 + `{ places: [], message }`. 프론트는 `state.failed`로 안내.

## 3. 장소 객체 (`/api/places` 응답의 `places[]`)
| 필드 | 의미 |
|---|---|
| `id` | 잇플 URL 마지막 조각 (공유 링크 `?p=`에 사용) |
| `name`, `addr`, `cat` | 정리된 가게명 / 주소(서울 영등포구 제거) / 업종 |
| `kind` | `meal` · `cafe` · `bar` (`kindOf`) |
| `region` | `seo` · `center` · `dong` (`regionOf`) |
| `lat`, `lng` | WGS84 위경도 |
| `nat`, `loc` | 전국 / 지역 매출 상위 % (낮을수록 상위) |
| `hours` | "10:30 – 21:30" 추정. 익일이면 "익일 " 접두 |
| `lunch`, `late`, `team`, `foreign`, `local` | 분위기 플래그 |
| `busyDay`, `busyTime` | 붐비는 요일/시간대 |
| `customers[]` | 주요 방문 고객층 원문 (프론트에서 `groupOf`로 6그룹화) |

### 좌표 변환
잇플 좌표는 TM128/KATEC → `proj4`로 WGS84 변환 (`toLatLng`). **카카오 지오코더와 비교해 대부분 0m 오차로 검증됨.** 핀 위치가 어긋나 보이면 데이터보다 핀 앵커(아래 5번)를 먼저 의심한다.

### 서여의도/동여의도 구분
여의대로 기준선(`LINE_A`~`LINE_B`) 서쪽 약 40m 이상이면 서여의도. 더현대·IFC·파크원은 주소 패턴(`CENTER_PATTERNS`)으로 먼저 분리.

## 4. 프론트 구조 (`app.js`)
| 구역 | 내용 |
|---|---|
| 상수 | `REGIONS` `KINDS` `MOODS` `TOPS` `GROUPS`, `MAP_MAX=150`, `YEOUIDO` 중심 좌표 |
| 상태 | `state`(places, selected …), 화면별 필터 `F.explore/map/top30/pick/local`, 홈은 `HOME`(조건 없음) |
| 필터 UI | `renderFilters` — `data-scope` / `data-group` 속성으로 칩을 채운다 |
| 목록 | `LISTS` 설정 배열 + `renderList` |
| 지도 | 아래 5번 |
| 카드 | `openCard` / `closeCard` / `cardBody` (데스크톱: 우측 패널, 모바일: 전체 + `history.pushState`) |
| 화면 전환 | `openScreen` / 닫기. `data-open-screen`, `data-close-screen` 속성 |
| 제비뽑기 | `resetPick` 등 |
| 진입 | `load()` → `initMap()` → `/api/places` → `update()` → `refitMap()` |

규칙: 화면별 필터는 서로 독립이다. 새 화면을 추가하면 `F`에 항목, `LISTS`에 목록, `index.html`에 `#screen-*`, 홈 `.sc` 버튼을 함께 추가한다.

## 5. 지도 (카카오맵 JavaScript SDK)
- SDK: `index.html` 맨 아래 `<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=…">` (동기 로드). **JavaScript 키**를 쓴다.
- 지도 인스턴스는 **하나**. 지도 화면을 열면 같은 `#map` 요소를 `#map-slot`으로 옮기고(`attachMap`), 닫으면 되돌린다(`detachMap`). 크기가 바뀌면 `relayout()` 후 `renderMap(true)` (`refitMap`).
- **핀은 `kakao.maps.CustomOverlay` + HTML**(기본 Marker 아님). `addPin()`:
  - 10위 이내·선택된 매장 → 번호 핀(`.pin`, 선택 시 `.sel`), 나머지 → 점(`.dot`)
  - 핀 끝이 좌표에 닿도록 **크기별로 앵커를 계산**(일반 32×38, 선택 40×46, 점 12×12). 핀 CSS 크기(`style.css`의 `.pin`/`.pin.sel`)를 바꾸면 `addPin`의 `tipY` 계산식도 같이 고쳐야 한다.
  - 순위 낮은 것부터 그려 상위 핀이 위로. `zIndex`: 상위일수록 높고 선택 핀 2000, 말풍선 3000.
  - 이벤트는 오버레이 DOM에 직접: `mouseenter/leave`(말풍선), `click`(카드 열기).
- `renderMap(fit)`: 기존 핀을 지우고 다시 그림. `fit`이면 상위 40개로 `setBounds`, 레벨은 3보다 크게 유지.
- `focusOnMap(p)`: 데스크톱에서 카드가 오른쪽을 가리므로 중심을 210px 보정한 **좌표 하나로 `panTo` 한 번만** 이동한다. (과거에 `setCenter` + `panBy`를 연달아 써서 튕기는 버그가 있었음 — 이동을 둘로 나누지 말 것)
- 확대 단계: 카카오 레벨(작을수록 확대). 기본 4, 최대 축소 10. (네이버 zoom 15 ≈ 카카오 level 4~5)
- **매장 좌표 보정**: 잇플 좌표는 주소 지점이라 큰 건물(IFC몰·파크원 등)에서 실제 매장과 최대 200m 넘게 어긋난다. `libraries=services`로 `kakao.maps.services.Places.keywordSearch`를 호출해 **같은 도로명 주소 + 비슷한 이름**인 매장을 찾으면 그 좌표와 장소 ID(`p.kakaoId`)로 바꾼다(`pickPlace`, `refine`). 이름이 다르면 매칭하지 않고 기존 좌표를 쓴다. 지도에 그려진 핀은 `queueRefine`이 백그라운드로 하나씩 처리하고, 결과는 `localStorage`(`yds-kp1`)에 캐시한다. 매칭 규칙을 바꾸면 캐시 키(`KP_KEY`)의 버전도 올린다.
- **말풍선 클릭 통과**: 말풍선 오버레이의 바깥 래퍼에도 `pointer-events:none`을 줘야 한다(`showTip`). 안 그러면 호버 중인 핀을 덮어서 클릭이 간헐적으로 안 된다.
- **길찾기 링크**: `kakaoMapUrl` — 장소 ID가 있으면 `https://map.kakao.com/link/to/{id}`, 없으면 `link/to/{이름},{위도},{경도}`. 이름 검색 링크(`link/search`)는 엉뚱한 매장이 나와서 쓰지 않는다.
- 모바일(`IS_MOBILE`)은 스크롤 충돌을 피해 기본 드래그/줌을 꺼 두고, "지도 크게 보기"에서만 켠다.

## 6. 환경 설정 · 로컬 실행
### 카카오 키
1. developers.kakao.com → 내 애플리케이션 → 앱 → **JavaScript 키**.
2. **JavaScript SDK 도메인**에 등록(포트까지, 끝 `/` 없이):
   `http://localhost:3000`, `https://yeouidosirak.vercel.app`
3. **카카오맵 사용 설정 ON** (꺼져 있으면 403 `disabled OPEN_MAP_AND_LOCAL service`).
4. 키는 공개되는 값이다(브라우저에 노출). 보호는 도메인 제한으로 한다. **REST API 키·Admin 키는 절대 프론트 코드에 넣지 않는다.**

### 로컬 서버
`/api/places`가 Vercel 함수라서 단순 정적 서버로는 데이터가 안 온다. 두 가지 방법:
- `vercel dev` (Vercel CLI 설치·로그인 필요)
- 정적 파일 + `api/places.js` 핸들러를 `localhost:3000`에서 같이 서비스하는 작은 Node 스크립트 (Claude Code 세션에서는 `.claude/launch.json` 사용 — **커밋하지 않는다**)

`file://`로 열면 카카오 도메인 검사에 걸리므로 반드시 등록한 주소로 연다.

### 지도가 안 나올 때 (진단 순서)
```bash
curl -s -H "Referer: http://localhost:3000/" "https://dapi.kakao.com/v2/maps/sdk.js?appkey=<키>"
```
| 응답 | 원인 / 조치 |
|---|---|
| 200 (JS 코드) | SDK 정상. 코드/레이아웃 문제 |
| 401 `domain mismatched` | SDK 도메인 미등록 |
| 403 `disabled OPEN_MAP_AND_LOCAL` | 카카오맵 사용 설정 OFF |
- 지도는 뜨는데 위치·확대가 엉뚱하면 컨테이너 크기를 재기 전에 그린 경우 → `refitMap()` 호출 확인.

## 7. 배포
- Vercel, Framework Preset **Other**. 푸시하면 자동 배포(브랜치별 프리뷰).
- 배포 주소가 바뀌면: `index.html`의 `og:image`, 카카오 SDK 도메인을 같이 바꾼다.
- 환경변수(선택): `KSKILL_PROXY_BASE_URL`.

## 8. 알려진 주의점
- 핀은 DOM 요소라 개수가 많으면 느려진다 → `MAP_MAX=150`으로 제한.
- 잇플 프록시는 주소 부분일치 + 상위 100건이라 도로명을 나눠 여러 번 호출한다. 새 도로가 누락되면 `ROADS`에 추가.
- `api/places.js`는 `cleanName`, `roundHalfHour`, `CATERER`를 export한다(테스트/재사용용).
- 영업 시간은 추정치다. UI에서 "예상"임을 항상 표기한다.

## 9. Git / 커밋 규칙
- 브랜치: `feature/bora` → `main`으로 PR.
- 커밋 메시지는 한국어로 "무엇을 했는지" 한 줄. 예: `지도를 카카오맵으로 교체`, `핀 위치 앵커 보정, 매장 선택 시 지도 이동 부드럽게 수정`
- 커밋하지 않는 것: `.claude/`, `node_modules`, `.vercel`.

## 10. 변경 이력 (최근)
| 커밋 | 내용 |
|---|---|
| (이번) | 핀 클릭 통과 수정, 실제 매장 좌표 보정, 길찾기를 좌표/장소ID 링크로 |
| c790bac | 핀 앵커 보정, 매장 선택 시 지도 이동 부드럽게 |
| 56631ef | 지도를 카카오맵으로 교체 |
| 0ffafdb | 메인화면 메뉴 생성 및 레이아웃 수정 |
| 5ebb971 | 캐치프레이즈 "광고 말고 영수증이 고른 집" |
| 1694f44 | 글꼴 분리(Jua는 로고·제목만), 영업시간 30분 단위 |
| 384b16f | 지도 바탕 OSM 타일 (이후 카카오로 교체) |

## 11. 유지보수 체크리스트
- [ ] 기능 추가 → `planner.md` 3번 표, 이 문서 4번 구조 갱신
- [ ] 지도 코드 수정 → 5번과 "알려진 주의점" 확인
- [ ] 핀/카드 CSS 수정 → `designer.md`와 `addPin` 앵커 계산 동시 확인
- [ ] 배포 도메인 변경 → 카카오 SDK 도메인, `og:image`
