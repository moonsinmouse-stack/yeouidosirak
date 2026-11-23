// 여의도시락 — 잇플(eat.pl) 맛집 데이터 중계 함수 (Vercel Serverless)
// k-skill bccard-eatpl-search 스킬의 공개 프록시를 여의도 도로명별로 호출해
// 합치고, 서여의도/동여의도/더현대·IFC 로 나눠 화면에 필요한 값만 돌려준다.

import proj4 from 'proj4';

const PROXY = process.env.KSKILL_PROXY_BASE_URL || 'https://k-skill-proxy.nomadamas.org';

// 잇플 좌표(TM128/KATEC) → 지도용 위경도(WGS84)
const KATEC = '+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +units=m +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +no_defs';
function toLatLng(x, y) {
  const X = Number(x), Y = Number(y);
  if (!Number.isFinite(X) || !Number.isFinite(Y) || X === 0 || Y === 0) return [null, null];
  const [lng, lat] = proj4(KATEC, 'EPSG:4326', [X, Y]);
  return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
}

// 프록시는 주소 텍스트 부분일치 + 매출 상위 최대 100건이라, 도로를 나눠 여러 번 묻는다.
const ROADS = [
  '여의대로', '국제금융로', '국제금융로2길', '국제금융로6길', '국제금융로8길',
  '여의나루로', '여의나루로4길', '의사당대로', '국회대로', '63로',
  '여의공원로', '은행로', '여의서로', '여의동로'
];

// 여의대로(여의도공원 동쪽 큰길)를 기준선으로 서/동을 나눈다. 좌표는 데이터의 TM128 값.
// 더현대 서울·파크원·IFC는 따로 구분하지 않고 동여의도에 포함한다.
const LINE_A = [304603, 547106]; // 여의대로 8
const LINE_B = [305554, 547840]; // 여의대로 128
const CENTER_PATTERNS = [/여의대로 108/, /국제금융로 10[^0-9]/, /국제금융로 10$/];

function regionOf(item) {
  const addr = item.merAddr || '';
  if (CENTER_PATTERNS.some((re) => re.test(addr))) return 'dong';
  const x = Number(item.xaxsVal);
  const y = Number(item.yaxsVal);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'dong';
  const dx = LINE_B[0] - LINE_A[0];
  const dy = LINE_B[1] - LINE_A[1];
  const cross = dx * (y - LINE_A[1]) - dy * (x - LINE_A[0]);
  // 기준선에서 서쪽(공원·국회·KBS 쪽)으로 약 40m 이상이면 서여의도
  return cross > 40000 ? 'seo' : 'dong';
}

// 회식할 만한 곳인가? (잇플의 '직장인 방문' 표시는 카페·김밥집에도 붙어서 회식 기준으로 쓰지 않는다)
// A: 고기·횟집·주점·치킨·족발 등 회식 업종 → 밤 8시 이후까지 영업하면 회식 적합
// B: 한식·찌개·중식·일식·양식 등 일반 식당 → 밤 10시 이후까지(또는 직장인 방문 표시 + 밤 9시 이후)일 때만
// 카페·분식·김밥·버거·도시락·푸드코트·샌드위치·빵·아이스크림과 패스트푸드·커피 브랜드는 제외
const TEAM_A = /고기구이|곱창|횟집|해산물|족발|보쌈|호프|주점|이자카야|양꼬치|바\(bar\)|^바$|포차|전\/부침개|치킨|뷔페|샤브|오마카세/;
const TEAM_B = /찜|탕|찌개|한정식|백반|기타한식|중식|일식|스시|초밥|이탈리아|외국식|아시안|멕시칸|피자|마라/;
const TEAM_NO = /카페|분식|김밥|버거|도시락|푸드코트|샌드위치|토스트|빵|베이커리|도넛|아이스크림|빙수|브런치|돈가스|라멘|국수|떡볶이|죽/;
const TEAM_NO_NAME = /커피|카페|coffee|cafe|판다익스프레스|맥도날드|버거킹|롯데리아|맘스터치|서브웨이|스타벅스|파파존스|도미노|피자헛|1달러/i;
function isTeamSpot(name, cat, end, overnight, empy) {
  if (!cat || TEAM_NO.test(cat) || TEAM_NO_NAME.test(name || '')) return false;
  if (TEAM_A.test(cat)) return overnight || (end !== null && end >= 2000);
  if (TEAM_B.test(cat)) return overnight || (end !== null && end >= 2200) || (empy && end !== null && end >= 2100);
  return false;
}

function kindOf(cat) {
  if (/카페|베이커리|디저트|아이스크림|도넛|빙수|제과|커피|차$/.test(cat)) return 'cafe';
  if (/주점|호프|이자카야|와인|바\(bar\)|^바$|포차|맥주|칵테일/.test(cat)) return 'bar';
  return 'meal';
}

// 위탁급식·구내식당 운영사 (일반 손님이 이용하기 어려운 곳이 많아 목록에서 뺀다)
const CATERER = /현대그린푸드|그린푸드|아워홈|웰스토리|프레시웨이|신세계푸드|풀무원푸드앤컬처|동원홈푸드|한화푸드테크|푸드테크|사업본부|구내식당|직원식당|사내식당|단체급식/;
// 법인 접미사
const CORP_TAIL = /(코퍼레이션|코퍼레이|홀딩스|컴퍼니|코리아|에프앤비|F&B|에프엔비|푸즈서비스|푸즈|푸드|산업|상사|유통|인터내셔널|글로벌)$/i;
const FOOD_WORD = /커피|카페|베이커리|빵|치킨|피자|김밥|국밥|분식|떡볶이|스시|초밥|고기|갈비|면|탕|순대|버거|샐러드|다이닝|키친|식당|반점|횟집|포차|호프|주점|비어|와인|라멘|돈까스|돈가스|쌀국수|찌개|곰탕|설렁탕|냉면|족발|보쌈|만두|우동|소바|타코|커리|카레|도시락|죽|토스트|샌드위치|베이글|도넛|디저트|아이스크림|빙수|티|차/;

// 결제 가맹점명 → 사람이 아는 가게 이름. 알아볼 수 없는 법인명만 남으면 null.
function cleanName(raw) {
  let n = (raw || '')
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|\(재\)|사단법인|재단법인/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // "브랜드/ 운영법인" → 브랜드
  if (n.includes('/')) n = n.split('/')[0].trim() || n.replace('/', ' ').trim();
  // 법인명이 매장명 앞에 붙어 있는 경우: "씨앤코컴퍼니카페블루포트…" → "카페블루포트…"
  n = n.replace(/^\S+?(코퍼레이션|컴퍼니|홀딩스)(?=\S)/, '');
  let parts = n.split(' ').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) {
    const t = parts[0].replace(/(\S)코리아(?=\S*점$)/, '$1 ');
    if (t.includes(' ')) return t;
    if (!CORP_TAIL.test(t)) return t;
    const stem = t.replace(CORP_TAIL, '');
    return FOOD_WORD.test(stem) && stem.length >= 2 ? stem : null;
  }
  // 맨 앞 토큰이 법인명: "커피빈코리아 ○○점" → "커피빈 ○○점", "재욱다이닝컴퍼니 호앙비엣" → "호앙비엣"
  if (CORP_TAIL.test(parts[0])) {
    const stem = parts[0].replace(CORP_TAIL, '');
    if (/코리아$/.test(parts[0]) && stem.length >= 2) parts[0] = stem;
    else parts = parts.slice(1);
  }
  // 맨 뒤 토큰이 법인 표기: "단디만 육당당 F&B" → "단디만 육당당"
  if (parts.length > 1 && (/^(F&B|에프앤비|에프엔비)$/i.test(parts[parts.length - 1]) || (CORP_TAIL.test(parts[parts.length - 1]) && !FOOD_WORD.test(parts[parts.length - 1].replace(CORP_TAIL, ''))))) {
    parts = parts.slice(0, -1);
  }
  n = parts.join(' ').replace(/(\S)코리아(?=\S*점$)/, '$1 ').replace(/\s+/g, ' ').trim();
  return n || null;
}

// 한 달 동안의 첫·마지막 결제 시각이라 실제 영업시간과 어긋날 수 있다. 가장 가까운 30분 단위로 다듬는다.
// (10:15 → 10:30, 09:52 → 10:00, 20:08 → 20:00)
function roundHalfHour(v) {
  if (!v || !/^\d{4}$/.test(v)) return null;
  let m = Number(v.slice(0, 2)) * 60 + Number(v.slice(2));
  m = Math.floor((m + 15) / 30) * 30;
  m %= 24 * 60;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function normalize(i, name) {
  const start = i.srtTime && /^\d{4}$/.test(i.srtTime) ? Number(i.srtTime) : null;
  const end = i.endTime && /^\d{4}$/.test(i.endTime) ? Number(i.endTime) : null;
  const overnight = start !== null && end !== null && end < start;
  const s = roundHalfHour(i.srtTime);
  const e = roundHalfHour(i.endTime);
  const cat = i.merTpbuzNm || '';
  const [lat, lng] = toLatLng(i.xaxsVal, i.yaxsVal);
  const customers = i.vistCstmrRnkList ? Object.keys(i.vistCstmrRnkList).sort().map((k) => i.vistCstmrRnkList[k]).filter(Boolean) : [];
  return {
    id: i.merUrl.split('/').pop(),
    name,
    addr: (i.merAddr || '').replace(/^서울 영등포구 /, ''),
    cat,
    kind: kindOf(cat),
    region: regionOf(i),
    lat,
    lng,
    nat: i.allSaleRnk,
    loc: i.ccgSaleRnk,
    url: i.merUrl,
    hours: s && e ? `${s} – ${overnight || e === '0:00' ? '익일 ' : ''}${e}` : null,
    lunch: start !== null && start <= 1130 && (overnight || (end !== null && end >= 1330)),
    late: overnight || (end !== null && end >= 2200),
    dinner: overnight || (end !== null && end >= 1900),
    team: isTeamSpot(name, cat, end, overnight, !!i.empyVsitYn),
    foreign: !!i.frnrVsitYn,
    local: !!i.loclPrsnPpltYn,
    busyDay: i.congestionDwk || null,
    busyTime: i.congestionTizn || null,
    customers
  };
}

async function fetchRoad(road) {
  const url = `${PROXY}/v1/bccard-eatpl/search?location=${encodeURIComponent('서울 영등포구 ' + road)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

let memo = null; // 같은 인스턴스가 살아 있는 동안 재사용
const MEMO_MS = 60 * 60 * 1000;

export async function loadPlaces() {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.data;
  const lists = await Promise.all(ROADS.map(fetchRoad));
  const byId = new Map();
  for (const items of lists) {
    for (const i of items) {
      if (!i || typeof i.merUrl !== 'string' || !i.merUrl.startsWith('https://web.paybooc.ai/')) continue;
      if (!/여의도동/.test(i.merAddr || '')) continue;
      if (/소매|편의점|마트|슈퍼|주류판매|반찬|매점/.test(i.merTpbuzNm || '')) continue;
      if (CATERER.test(i.merNm || '')) continue;
      const name = cleanName(i.merNm);
      if (!name) continue;
      const p = normalize(i, name);
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  const data = [...byId.values()].sort((a, b) => (a.loc ?? 999) - (b.loc ?? 999) || (a.nat ?? 999) - (b.nat ?? 999));
  if (data.length) memo = { at: Date.now(), data };
  return data;
}

export default async function handler(req, res) {
  try {
    const places = await loadPlaces();
    if (!places.length) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ places: [], message: '지금은 맛집 정보를 불러오지 못했어요.' });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      attribution: 'eat.pl 잇플 · BC카드 결제 데이터 기반',
      places
    });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ places: [], message: '지금은 맛집 정보를 불러오지 못했어요.' });
  }
}
export { cleanName, roundHalfHour, CATERER };
