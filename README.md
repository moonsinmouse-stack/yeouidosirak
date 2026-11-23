# 여의도시락

별점 말고, 여의도가 실제로 많이 결제한 집.
BC카드 eat.pl 잇플 데이터(k-skill `bccard-eatpl-search` 스킬)로 여의도 맛집을 매출 순위로 보여 주는 모바일 우선 웹 서비스입니다.

## 구성
- `index.html`, `style.css`, `app.js` — 화면 (빌드 없음)
- `api/places.js` — Vercel 서버 함수. k-skill 프록시를 여의도 도로명별로 호출해 합치고 서여의도 / 더현대·IFC / 동여의도로 분류
- 맛집 카드의 "eat.pl에서 자세히 보기" 링크가 잇플로 보내는 핵심 동선 (referrer 유지)

## 내 컴퓨터에서 보기
Node.js 18 이상이 필요합니다.
```bash
npm install
npm start
```
브라우저에서 http://localhost:3000 을 엽니다. 포트를 바꾸려면 `PORT=4000 npm start`.

## 배포 (Vercel)
1. vercel.com 에 GitHub 로 로그인 → Add New → Project → `yeouidosirak` Import
2. Framework Preset: **Other**, 그대로 Deploy
3. 나온 주소(예: `yeouidosirak.vercel.app`)를 공모전 참가 신청에 서비스 도메인으로 등록
4. 주소가 다르면 `index.html` 의 `og:image` 주소를 그 주소로 바꾸기

## 데이터 고지
eat.pl 잇플 · BC카드 결제 데이터 기반. 순위는 최근 1개월 결제 기준이며 영업 예상 시간은 공식 영업시간이 아닙니다. 이 서비스는 BC카드·잇플의 공식 서비스가 아닙니다.
