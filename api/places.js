// 여의도시락 — 잇플(eat.pl) 맛집 데이터 중계 함수 (Vercel Serverless)
// k-skill bccard-eatpl-search 스킬의 공개 프록시를 여의도 도로명별로 호출해
// 합치고, 서여의도/동여의도/더현대·IFC 로 나눠 화면에 필요한 값만 돌려준다.

const PROXY = process.env.KSKILL_PROXY_BASE_URL || 'https://k-skill-proxy.nomadamas.org';

// 프록시는 주소 텍스트 부분일치 + 매출 상위 최대 100건이라, 도로를 나눠 여러 번 묻는다.
const ROADS = [
  '여의대로', '국제금융로', '국제금융로2길', '국제금융로6길', '국제금융로8길',
  '여의나루로', '여의나루로4길', '의사당대로', '국회대로', '63로',
  '여의공원로', '은행로', '여의서로', '여의동로'
];

// 여의대로(여의도공원 동쪽 큰길)를 기준선으로 서/동을 나눈다. 좌표는 데이터의 TM128 값.
const LINE_A = [304603, 547106]; // 여의대로 8
const LINE_B = [305554, 547840]; // 여의대로 128
const CENTER_PATTERNS = [/여의대로 108/, /국제금융로 10[^0-9]/, /국제금융로 10$/];

function regionOf(item) {
  const addr = item.merAddr || '';
  if (CENTER_PATTERNS.some((re) => re.test(addr))) return 'center';
  const x = Number(item.xaxsVal);
  const y = Number(item.yaxsVal);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'dong';
  const dx = LINE_B[0] - LINE_A[0];
  const dy = LINE_B[1] - LINE_A[1];
  const cross = dx * (y - LINE_A[1]) - dy * (x - LINE_A[0]);
  // 기준선에서 서쪽(공원·국회·KBS 쪽)으로 약 40m 이상이면 서여의도
  return cross > 40000 ? 'seo' : 'dong';
}

function kindOf(cat) {
  if (/카페|베이커리|디저트|아이스크림|도넛|빙수|제과|커피|차$/.test(cat)) return 'cafe';
  if (/주점|호프|이자카야|와인|바\(bar\)|^바$|포차|맥주|칵테일/.test(cat)) return 'bar';
  return 'meal';
}

function cleanName(n) {
  const out = (n || '')
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || n;
}

function hhmm(v) {
  if (!v || !/^\d{4}$/.test(v)) return null;
  return `${v.slice(0, 2)}:${v.slice(2)}`;
}

function normalize(i) {
  const start = i.srtTime && /^\d{4}$/.test(i.srtTime) ? Number(i.srtTime) : null;
  const end = i.endTime && /^\d{4}$/.test(i.endTime) ? Number(i.endTime) : null;
  const overnight = start !== null && end !== null && end < start;
  const s = hhmm(i.srtTime);
  const e = hhmm(i.endTime);
  const cat = i.merTpbuzNm || '';
  const customers = i.vistCstmrRnkList ? Object.keys(i.vistCstmrRnkList).sort().map((k) => i.vistCstmrRnkList[k]).filter(Boolean) : [];
  return {
    id: i.merUrl.split('/').pop(),
    name: cleanName(i.merNm),
    addr: (i.merAddr || '').replace(/^서울 영등포구 /, ''),
    cat,
    kind: kindOf(cat),
    region: regionOf(i),
    nat: i.allSaleRnk,
    loc: i.ccgSaleRnk,
    url: i.merUrl,
    hours: s && e ? `${s} – ${overnight ? '익일 ' : ''}${e}` : null,
    lunch: start !== null && start <= 1130 && (overnight || (end !== null && end >= 1330)),
    late: overnight || (end !== null && end >= 2200),
    team: !!i.empyVsitYn,
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
      const p = normalize(i);
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
