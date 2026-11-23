(() => {
  'use strict';

  const REGIONS = [
    { id: 'all', label: '전체', sub: '여의도 전체' },
    { id: 'seo', label: '서여의도', sub: '국회·KBS 쪽' },
    { id: 'center', label: '더현대·IFC', sub: '파크원 포함' },
    { id: 'dong', label: '동여의도', sub: '증권가·63 쪽' }
  ];
  const KINDS = [
    { id: 'all', label: '전부' },
    { id: 'meal', label: '밥집' },
    { id: 'cafe', label: '카페·디저트' },
    { id: 'bar', label: '술집' }
  ];
  const MOODS = [
    { id: 'lunch', label: '점심' },
    { id: 'team', label: '회식' },
    { id: 'late', label: '늦게까지' },
    { id: 'foreign', label: '외국인 많은' },
    { id: 'local', label: '동네 사람 맛집' }
  ];
  const TOPS = [
    { id: 10, label: '상위 10곳' },
    { id: 30, label: '상위 30곳' },
    { id: 0, label: '조건에 맞는 전부' }
  ];
  // 잇플 '주요 방문 고객층'(예: 30대남성, 60대이상여성)을 연령대 + 성별 6개로 묶는다.
  const GROUPS = [
    { id: 'f2030', label: '2030 여성' },
    { id: 'm2030', label: '2030 남성' },
    { id: 'f4050', label: '4050 여성' },
    { id: 'm4050', label: '4050 남성' },
    { id: 'f60', label: '60대 이상 여성' },
    { id: 'm60', label: '60대 이상 남성' }
  ];
  function groupOf(text) {
    const m = /^(\d+)대(이상)?(여성|남성)$/.exec(String(text || '').replace(/\s+/g, ''));
    if (!m) return null;
    const sex = m[3] === '여성' ? 'f' : 'm';
    const age = Number(m[1]);
    if (age >= 60) return `${sex}60`;
    if (age >= 40) return `${sex}4050`;
    if (age >= 20) return `${sex}2030`;
    return null;
  }
  const REGION_NAME = { seo: '서여의도', center: '더현대·IFC', dong: '동여의도' };
  const PAGE = 20;
  const MAP_MAX = 150;
  const YEOUIDO = [37.5238, 126.9265];

  const state = { places: [], loaded: false, failed: false, selected: null, lastPick: null };

  // 홈은 조건 없이 전체를 보여 주고, 바로가기 화면마다 자기 조건을 따로 가진다.
  const newFilter = (o = {}) => ({ region: 'all', kind: 'all', moods: new Set(), groups: new Set(), local: false, ...o });
  const HOME = newFilter();
  const F = {
    explore: newFilter(),
    map: newFilter(),
    top30: newFilter(),
    local: newFilter({ local: true }),
    pick: newFilter({ kind: 'meal', moods: new Set(['lunch']), top: 30 }) // 기존 제비뽑기 기본 조건 유지
  };
  const SHOWN = { home: PAGE, explore: PAGE, local: PAGE };
  const TOP_N = 30;
  let openScreenId = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const svgUse = (cls) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#dori'); s.append(u);
    return s;
  };
  const icon = (d) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  };
  const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
  const regionLabel = (f) => REGIONS.find((r) => r.id === f.region).label;

  function filtered(f) {
    return state.places.filter((p) => {
      if (f.region !== 'all' && p.region !== f.region) return false;
      if (f.kind !== 'all' && p.kind !== f.kind) return false;
      if (f.local && !p.local) return false;
      for (const m of f.moods) if (!p[m]) return false;
      if (f.groups.size && ![...f.groups].some((g) => p.groups.has(g))) return false;
      return true;
    });
  }

  function tagsFor(p) {
    const t = [el('span', { class: 'tag' }, p.cat || '음식점')];
    if (p.team) t.push(el('span', { class: 'tag mint' }, '회식 적합'));
    if (p.local) t.push(el('span', { class: 'tag mint' }, '동네 사람 맛집'));
    if (p.foreign) t.push(el('span', { class: 'tag coral' }, '외국인 많음'));
    if (p.busyTime) t.push(el('span', { class: 'tag coral' }, `${p.busyTime} 붐빔`));
    return t;
  }

  // ---------- 조건 버튼 (화면마다 자기 조건을 가진다: data-scope) ----------
  function changed(scope) { if (scope in SHOWN) SHOWN[scope] = PAGE; update(); }

  function renderFilters() {
    for (const box of $$('[data-scope]')) {
      const scope = box.dataset.scope;
      const f = F[scope];
      const single = (key, val) => () => { f[key] = val; changed(scope); };
      const multi = (set, id) => () => { set.has(id) ? set.delete(id) : set.add(id); changed(scope); };
      const chip = (label, on, onclick) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick }, label);
      switch (box.dataset.group) {
        case 'region':
          box.replaceChildren(...REGIONS.map((r) => el('button', {
            class: 'region', type: 'button', 'aria-pressed': String(f.region === r.id), onclick: single('region', r.id)
          }, el('b', {}, r.label), el('small', {}, r.sub))));
          break;
        case 'kind':
          box.replaceChildren(...KINDS.map((k) => chip(k.label, f.kind === k.id, single('kind', k.id))));
          break;
        case 'mood':
          box.replaceChildren(...MOODS.map((m) => chip(m.label, f.moods.has(m.id), multi(f.moods, m.id))));
          break;
        case 'cust':
          box.replaceChildren(...GROUPS.map((g) => chip(g.label, f.groups.has(g.id), multi(f.groups, g.id))));
          break;
        case 'top':
          box.replaceChildren(...TOPS.map((t) => chip(t.label, f.top === t.id, single('top', t.id))));
          break;
      }
    }
  }

  // ---------- 목록 (홈 + 바로가기 화면) ----------
  const LISTS = [
    { scope: 'home', f: HOME, list: '#list', more: '#more', title: '#result-title', name: (f, n) => `${regionLabel(f)} ${n}곳` },
    { scope: 'explore', f: F.explore, list: '#xlist', more: '#xmore', title: '#xtitle', name: (f, n) => `${regionLabel(f)} ${n}곳` },
    { scope: 'top30', f: F.top30, list: '#tlist', more: null, title: '#ttitle', max: TOP_N, name: (f, n) => `${regionLabel(f)} 상위 ${n}곳` },
    { scope: 'local', f: F.local, list: '#llist', more: '#lmore', title: '#ltitle', name: (f, n) => `${regionLabel(f)} 동네 인기 ${n}곳` }
  ];

  function renderList(cfg) {
    const list = $(cfg.list); list.replaceChildren();
    const more = cfg.more ? $(cfg.more) : null;
    const title = $(cfg.title);
    if (more) more.hidden = true;
    if (!state.loaded) {
      title.textContent = '불러오는 중…';
      for (let i = 0; i < 4; i++) list.append(el('li', { class: 'skeleton', 'aria-hidden': 'true' }));
      return;
    }
    if (state.failed) {
      title.textContent = '앗, 잠깐만요';
      list.append(el('li', { class: 'empty' }, '지금은 맛집 정보를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
      return;
    }
    let items = filtered(cfg.f);
    if (cfg.max) items = items.slice(0, cfg.max);
    title.textContent = cfg.name(cfg.f, items.length);
    if (!items.length) {
      list.append(el('li', { class: 'empty' }, '이 조건에 맞는 집이 없어요. 조건을 하나 빼 보세요.'));
      return;
    }
    const limit = cfg.max ? items.length : SHOWN[cfg.scope];
    items.slice(0, limit).forEach((p, i) => {
      list.append(el('li', {},
        el('button', {
          class: 'row', type: 'button', 'aria-current': state.selected && state.selected.id === p.id ? 'true' : null,
          onclick: () => openCard(p)
        },
          el('span', { class: 'rank' }, String(i + 1)),
          el('span', { class: 'row-main' }, el('span', { class: 'row-name' }, p.name), el('span', { class: 'tags' }, tagsFor(p).slice(0, 3))),
          el('span', { class: 'row-num' }, el('small', {}, '지역 상위'), el('b', {}, pct(p.loc)))
        )));
    });
    if (more) more.hidden = items.length <= limit;
  }

  // 홈은 항상, 바로가기 화면은 열려 있을 때만 그린다.
  function renderLists() {
    for (const cfg of LISTS) if (cfg.scope === 'home' || cfg.scope === openScreenId) renderList(cfg);
  }

  // ---------- 지도 (카카오맵 JS SDK) ----------
  let map = null;
  let tip = null;
  const markers = new Map();
  let mapBig = false;
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ll = (p) => new kakao.maps.LatLng(p.lat, p.lng);
  const htmlEl = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };

  // 지도 화면이 열려 있으면 그 화면의 조건, 아니면 홈(전체)
  const mapFilter = () => (openScreenId === 'map' ? F.map : HOME);

  function initMap() {
    if (map) return;
    if (!window.kakao || !kakao.maps) {
      $('#map').textContent = '지도를 불러오지 못했어요. 카카오 JavaScript 키와 등록한 웹 도메인을 확인해 주세요.';
      return;
    }
    map = new kakao.maps.Map($('#map'), {
      center: new kakao.maps.LatLng(YEOUIDO[0], YEOUIDO[1]), level: 4
    });
    map.setMaxLevel(10);
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.TOPRIGHT);
    map.setDraggable(!IS_MOBILE);
    map.setZoomable(!IS_MOBILE);
    tip = new kakao.maps.CustomOverlay({ content: '', yAnchor: 1, xAnchor: 0.5, zIndex: 3000 });
  }

  function showTip(m, text) {
    const node = htmlEl(`<div style="pointer-events:none;padding-bottom:${m.h + 4}px"><div class="nm-tip">${esc(text)}</div></div>`);
    tip.setContent(node);
    tip.setPosition(m.pos);
    tip.setMap(map);
    // 카카오가 감싸는 바깥 래퍼도 클릭을 통과시켜야 아래 핀이 눌린다
    if (node.parentElement) node.parentElement.style.pointerEvents = 'none';
  }

  // ---------- 실제 매장 좌표 보정 (카카오 장소 검색) ----------
  // 잇플 좌표는 주소 지점이라 같은 건물 안에서 실제 매장과 어긋날 수 있다.
  // 카카오 장소 검색에서 같은 도로명 주소 + 비슷한 이름의 매장을 찾으면 그 좌표·장소 ID를 쓴다.
  const KP_KEY = 'yds-kp1';
  let kp = {};
  try { kp = JSON.parse(localStorage.getItem(KP_KEY) || '{}') || {}; } catch { kp = {}; }
  let kpTimer = null;
  const kpSave = () => {
    clearTimeout(kpTimer);
    kpTimer = setTimeout(() => { try { localStorage.setItem(KP_KEY, JSON.stringify(kp)); } catch { /* 저장 불가면 무시 */ } }, 600);
  };
  let placesSvc = null;
  const places = () => {
    if (placesSvc) return placesSvc;
    if (window.kakao && kakao.maps && kakao.maps.services) placesSvc = new kakao.maps.services.Places();
    return placesSvc;
  };
  const normName = (t) => String(t || '').replace(/[\s()·.\-_/]/g, '').toLowerCase();
  function nameScore(a, b) {
    const x = normName(a), y = normName(b);
    if (!x || !y) return 0;
    if (x.includes(y) || y.includes(x)) return 3;
    let k = 0;
    for (let i = 0; i < y.length - 1; i++) if (x.includes(y.slice(i, i + 2))) k++;
    return k >= Math.max(2, Math.ceil((y.length - 1) / 2)) ? 1 : 0;
  }
  function pickPlace(p, data) {
    const core = /^(\S+)\s+(\d+(?:-\d+)?)/.exec(p.addr || '');
    const addrRe = core ? new RegExp(`${core[1]}\\s*${core[2]}(?![\\d-])`) : null;
    let best = null, bestScore = 0;
    for (const d of data) {
      const sim = nameScore(d.place_name, p.name);
      if (!sim) continue;
      const dist = Number(d.distance) || 0;
      const sameAddr = !!(addrRe && addrRe.test(d.road_address_name || ''));
      if (!sameAddr && dist > 120) continue;
      const score = sim * 10 + (sameAddr ? 5 : 0) - dist / 100;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }
  function applyRefine(p, v) {
    if (v) { p.lat = v[0]; p.lng = v[1]; p.kakaoId = v[2]; p.refined = true; } else { p.refined = false; }
    const m = markers.get(p.id) || (extraPin && state.selected && state.selected.id === p.id ? extraPin : null);
    if (m && v) m.move(ll(p));
  }
  function refine(p) {
    if (p.refined !== undefined || !p.lat) return Promise.resolve(p);
    if (kp[p.id] !== undefined) { applyRefine(p, kp[p.id]); return Promise.resolve(p); }
    const svc = places();
    if (!svc) return Promise.resolve(p);
    return new Promise((resolve) => {
      svc.keywordSearch(p.name, (data, status) => {
        const S = kakao.maps.services.Status;
        if (status === S.OK || status === S.ZERO_RESULT) {
          const hit = status === S.OK ? pickPlace(p, data) : null;
          const v = hit ? [Number(hit.y), Number(hit.x), hit.id] : 0;
          kp[p.id] = v; kpSave(); applyRefine(p, v);
        }
        resolve(p);
      }, { location: ll(p), radius: 300, size: 10 });
    });
  }
  // 지도에 그려진 핀을 백그라운드에서 한두 개씩 보정한다 (요청이 몰리지 않게)
  const refineQueue = [];
  let refineRunning = false;
  async function runRefineQueue() {
    if (refineRunning) return;
    refineRunning = true;
    while (refineQueue.length) {
      const p = refineQueue.shift();
      if (p.refined !== undefined) continue;
      try { await refine(p); } catch { /* 한 곳이 실패해도 다음으로 */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    refineRunning = false;
  }
  function queueRefine(items) {
    for (const p of items) if (p.refined === undefined && !refineQueue.includes(p)) refineQueue.push(p);
    runRefineQueue();
  }

  // 핀은 HTML 오버레이로 그린다. m = { overlay, pos, h, setMap }
  function addPin(p, rank, label, z) {
    const sel = state.selected && state.selected.id === p.id;
    const big = rank <= 10 || sel || rank === '★';
    // 핀 끝(회전한 네모의 모서리)이 좌표에 정확히 닿도록 크기별로 앵커를 잡는다
    // 끝 y = 핀 중심 y + 반대각선(변×0.707) − 둥근 모서리(4px) 깎임 ≈ 1.66
    let w, h, tipY;
    if (sel) { w = 40; h = 46; tipY = 18 + 36 * 0.7071 - 1.66; }
    else if (big) { w = 32; h = 38; tipY = 15 + 30 * 0.7071 - 1.66; }
    else { w = 12; h = 12; tipY = 6; }
    const node = htmlEl(big
      ? `<div class="pin-wrap" style="width:${w}px;height:${h}px;cursor:pointer"><span class="pin${sel ? ' sel' : ''}"><i>${rank}</i></span></div>`
      : `<div class="pin-wrap" style="width:${w}px;height:${h}px;cursor:pointer"><span class="dot"></span></div>`);
    node.title = p.name;
    const pos = ll(p);
    const overlay = new kakao.maps.CustomOverlay({
      position: pos, content: node, map, zIndex: z,
      xAnchor: 0.5, yAnchor: tipY / h
    });
    const m = { overlay, pos, h: tipY, setMap: (x) => overlay.setMap(x), move(np) { this.pos = np; overlay.setPosition(np); } };
    node.addEventListener('mouseenter', () => showTip(m, label));
    node.addEventListener('mouseleave', () => tip.setMap(null));
    return { m, node };
  }

  function renderMap(fit = true) {
    if (!map) return;
    for (const m of markers.values()) m.setMap(null);
    markers.clear();
    if (extraPin) { extraPin.setMap(null); extraPin = null; }
    tip.setMap(null);
    if (!state.loaded || state.failed) return;
    const items = filtered(mapFilter()).filter((p) => p.lat && p.lng).slice(0, MAP_MAX);
    // 순위가 낮은 것부터 그려서 상위 핀이 위에 오게
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      const rank = i + 1;
      const { m, node } = addPin(p, rank, `${rank}. ${p.name}`, rank <= 10 ? 1000 - rank : 0);
      node.addEventListener('click', () => openCard(p));
      markers.set(p.id, m);
    }
    if (state.selected && !markers.has(state.selected.id) && state.selected.lat) {
      extraPin = addPin(state.selected, '★', state.selected.name, 2000).m;
    }
    queueRefine(items);
    if (fit && items.length) {
      const b = new kakao.maps.LatLngBounds();
      items.slice(0, 40).forEach((p) => b.extend(ll(p)));
      map.setBounds(b, 28, 28, 28, 28);
      if (map.getLevel() < 3) map.setLevel(3);
    }
  }
  let extraPin = null;

  function focusOnMap(p) {
    if (!map || !p.lat) return;
    renderMap(false);
    if (map.getLevel() > 4) map.setLevel(4);
    // 데스크톱은 카드가 지도 오른쪽을 가리므로 핀이 카드 왼쪽에 보이게 중심을 옮긴다.
    // 순간이동 없이 최종 중심점 하나로 부드럽게 한 번만 이동한다.
    let target = ll(p);
    if (isDesktop()) {
      const proj = map.getProjection();
      const box = $('#map').getBoundingClientRect();
      const c = proj.coordsFromContainerPoint(new kakao.maps.Point(box.width / 2, box.height / 2));
      const r = proj.coordsFromContainerPoint(new kakao.maps.Point(box.width / 2 + 210, box.height / 2));
      target = new kakao.maps.LatLng(target.getLat() + (r.getLat() - c.getLat()), target.getLng() + (r.getLng() - c.getLng()));
    }
    map.panTo(target);
    const m = markers.get(p.id) || extraPin;
    if (m) showTip(m, p.name);
  }

  const resizeMap = () => { if (map) map.relayout(); };

  function toggleMapBig(force) {
    mapBig = typeof force === 'boolean' ? force : !mapBig;
    $('#map-wrap').classList.toggle('big', mapBig);
    document.body.style.overflow = mapBig ? 'hidden' : '';
    $('#map-toggle').textContent = mapBig ? '지도 닫기' : '지도 크게 보기';
    if (map) {
      if (IS_MOBILE) { map.setDraggable(mapBig); map.setZoomable(mapBig); }
      setTimeout(resizeMap, 60);
    }
  }

  // 지도 화면에서는 같은 지도를 화면 안으로 옮겨 쓴다 (지도 인스턴스는 하나)
  // 컨테이너 크기가 바뀐 뒤에 크기를 다시 재고 핀 범위를 맞춘다
  const refitMap = () => { if (map) setTimeout(() => { resizeMap(); renderMap(true); }, 80); };
  function attachMap() {
    if (mapBig) toggleMapBig(false);
    $('#map-slot').append($('#map'));
    refitMap();
  }
  function detachMap() {
    $('#map-wrap').prepend($('#map'));
    refitMap();
  }

  function update() { renderFilters(); renderLists(); renderMap(true); renderPickScope(); }

  // ---------- 맛집 카드 ----------
  const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;
  const shareUrl = (p) => `${location.origin}/?p=${encodeURIComponent(p.id)}`;
  // 카카오맵 길찾기(도착지 지정) 링크. 장소 ID가 있으면 그 매장으로, 없으면 이름+좌표로 정확히 찍는다.
  const kakaoMapUrl = (p) => (p.kakaoId
    ? `https://map.kakao.com/link/to/${p.kakaoId}`
    : `https://map.kakao.com/link/to/${encodeURIComponent(p.name.replace(/[,]/g, ' '))},${p.lat},${p.lng}`);

  async function share(p, lead) {
    const url = shareUrl(p);
    const text = `${lead || '오늘 점심 여기 어때?'} 🍱 ${p.name} (지역 매출 상위 ${pct(p.loc)})`;
    try {
      if (navigator.share) { await navigator.share({ title: '여의도시락', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('링크를 복사했어요. 단톡방에 붙여 넣어 주세요!');
    } catch {
      window.prompt('이 링크를 복사해 주세요', url);
    }
  }

  // 잇플로 보내는 링크: 순 사용자 집계를 위해 referrer 를 지우지 않는다(noreferrer 금지).
  const eatLink = (p, label) => el('a', { class: 'btn-eat', href: p.url, target: '_blank', rel: 'noopener' }, label || '메뉴 · 후기 요약 보기');

  function cardBody(p) {
    const facts = [];
    if (p.hours) facts.push(['영업 예상 시간', `${p.hours} 쯤`]);
    if (p.busyDay || p.busyTime) facts.push(['붐비는 때', [p.busyDay ? `${p.busyDay}요일` : null, p.busyTime].filter(Boolean).join(' · ')]);
    if (p.customers.length) facts.push(['주요 손님', p.customers.join(' · ')]);
    facts.push(['주소', p.addr]);
    return el('div', { class: 'box' },
      el('div', { class: 'tags' },
        el('span', { class: 'tag' }, p.cat || '음식점'),
        el('span', { class: 'tag mint' }, REGION_NAME[p.region] || '여의도'),
        p.team ? el('span', { class: 'tag mint' }, '회식 적합') : null,
        p.late ? el('span', { class: 'tag coral' }, '늦게까지') : null,
        p.foreign ? el('span', { class: 'tag coral' }, '외국인 많음') : null,
        p.local ? el('span', { class: 'tag mint' }, '동네 사람 맛집') : null
      ),
      el('h2', { class: 'card-name' }, p.name),
      el('div', { class: 'stats' },
        el('div', { class: 'stat hot' }, el('small', {}, '전국 매출 상위'), el('b', {}, pct(p.nat))),
        el('div', { class: 'stat' }, el('small', {}, '지역 매출 상위'), el('b', {}, pct(p.loc)))
      ),
      el('dl', { class: 'facts' }, facts.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v)))),
      el('p', { class: 'note' }, '순위는 최근 1개월 BC카드 결제 데이터 기준이에요. 영업 예상 시간은 한 달 동안의 첫·마지막 결제 시각으로 짐작한 거라 실제와 30분쯤 다를 수 있어요. · eat.pl 잇플 · BC카드 결제 데이터 기반')
    );
  }

  // 링크는 누르는 순간의 최신 좌표로 만든다 (보정이 끝났으면 보정된 값 사용)
  function mapLink(p) {
    const a = el('a', { class: 'btn-sub', href: kakaoMapUrl(p), target: '_blank', rel: 'noopener' }, '카카오맵에서 위치 · 길찾기');
    a.addEventListener('click', () => { a.href = kakaoMapUrl(p); });
    refine(p).then(() => { a.href = kakaoMapUrl(p); });
    return a;
  }

  function openCard(p, { fromShare = false } = {}) {
    const wasOpen = !!state.selected;
    state.selected = p;
    if (mapBig && !isDesktop()) toggleMapBig(false);
    const pane = $('#pane');
    const desk = isDesktop();
    pane.replaceChildren(el('div', { class: 'pane-inner' },
      el('div', { class: 'pane-top' },
        el('button', { class: 'icon-btn btn-back', type: 'button', 'aria-label': desk ? '카드 닫기' : '목록으로', onclick: () => (desk ? closeCard() : history.back()) }, icon(desk ? 'M6 6l12 12M18 6L6 18' : 'M15 5l-7 7 7 7')),
        el('span', { class: 'jua' }, fromShare ? '친구가 보낸 도시락' : '도시락 뚜껑 열기'),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '공유하기', onclick: () => share(p) }, icon('M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13'))
      ),
      el('div', { class: 'lid' }, svgUse('dori')),
      cardBody(p),
      el('div', { class: 'actions' },
        eatLink(p),
        el('p', { class: 'note center' }, 'BC카드 잇플(eat.pl)에서 메뉴 · AI 후기 요약 · 지금 영업 중인지 볼 수 있어요'),
        mapLink(p),
        el('button', { class: 'btn-sub', type: 'button', onclick: () => share(p) }, '단톡방에 "오늘 여기 어때?" 보내기')
      )
    ));
    pane.hidden = false;
    pane.scrollTop = 0;
    if (!desk) {
      document.body.style.overflow = 'hidden';
      if (!wasOpen) history.pushState({ card: p.id }, '', `?p=${encodeURIComponent(p.id)}`);
      else history.replaceState({ card: p.id }, '', `?p=${encodeURIComponent(p.id)}`);
    } else {
      history.replaceState({ card: p.id }, '', `?p=${encodeURIComponent(p.id)}`);
      focusOnMap(p);
    }
    pane.querySelector('.btn-back').focus();
    renderLists();
  }

  function closeCard() {
    state.selected = null;
    $('#pane').hidden = true;
    document.body.style.overflow = '';
    history.replaceState({}, '', location.pathname);
    renderLists(); renderMap(false);
  }

  // 모바일: 카드가 화면 위에 열려 있으면 카드부터 닫고, 그다음 뒤로가기가 화면을 닫는다.
  window.addEventListener('popstate', () => {
    if (!isDesktop() && !$('#pane').hidden) { closeCard(); return; }
    if (openScreenId) hideScreen();
  });

  // ---------- 바로가기 화면 ----------
  function openScreen(id) {
    if (openScreenId) return;
    openScreenId = id;
    const s = $(`#screen-${id}`);
    s.hidden = false; s.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    if (id === 'map') attachMap();
    if (id === 'pick') resetPick();
    update();
    history.pushState({ screen: id }, '', location.search || location.pathname);
    s.querySelector('[data-close-screen]').focus();
  }

  function hideScreen() {
    if (!openScreenId) return;
    const id = openScreenId;
    openScreenId = null;
    $(`#screen-${id}`).hidden = true;
    if (id === 'map') detachMap();
    if ($('#pane').hidden || isDesktop()) document.body.style.overflow = '';
    if (id !== 'map') renderMap(true);
  }

  // ---------- 조건 제비뽑기 ----------
  function pool() {
    const items = filtered(F.pick);
    return F.pick.top ? items.slice(0, F.pick.top) : items;
  }

  function renderPickScope() {
    if (openScreenId !== 'pick') return;
    const n = pool().length;
    const scope = $('#pick-scope');
    const btn = $('#draw');
    if (!state.loaded) { scope.textContent = '맛집 정보를 불러오는 중이에요'; btn.disabled = true; return; }
    if (!n) { scope.textContent = '이 조건에 맞는 집이 없어요. 조건을 하나 빼 보세요.'; btn.disabled = true; return; }
    const moods = MOODS.filter((m) => F.pick.moods.has(m.id)).map((m) => m.label);
    const kind = KINDS.find((k) => k.id === F.pick.kind);
    const parts = [regionLabel(F.pick), F.pick.kind === 'all' ? null : kind.label, ...moods].filter(Boolean).join(' · ');
    scope.replaceChildren(el('b', {}, `${n}곳`), ` 중에서 뽑아요 (${parts})`);
    btn.disabled = false;
  }

  function resetPick() {
    $('#pick-result').replaceChildren();
    $('#cup').classList.remove('picked');
    $('#draw').textContent = '젓가락 뽑기!';
  }

  function draw() {
    const items = pool();
    if (!items.length) return;
    let p = items[Math.floor(Math.random() * items.length)];
    if (items.length > 1 && state.lastPick && p.id === state.lastPick.id) p = items[(items.indexOf(p) + 1) % items.length];
    state.lastPick = p;
    const cup = $('#cup');
    cup.classList.remove('picked', 'shake'); void cup.offsetWidth; cup.classList.add('shake');
    setTimeout(() => {
      cup.classList.remove('shake'); cup.classList.add('picked');
      $('#pick-result').replaceChildren(el('div', { class: 'result-card' },
        el('div', { class: 'r-meta' }, '오늘의 여의도시락은'),
        el('div', { class: 'r-name' }, p.name),
        el('div', { class: 'r-meta' }, `${p.cat} · ${REGION_NAME[p.region] || '여의도'} · 지역 매출 상위 ${pct(p.loc)}`),
        el('div', { class: 'r-actions' },
          eatLink(p, '메뉴 · 후기 보기'),
          el('button', { class: 'btn-sub', type: 'button', onclick: () => share(p, '제비뽑기 결과 나왔다!') }, '단톡방에 보내기'),
          el('button', { class: 'btn-sub', type: 'button', onclick: () => { history.back(); setTimeout(() => openCard(p), 300); } }, '카드 · 지도 보기')
        )
      ));
      $('#draw').textContent = '다시 뽑기';
      $('#pick-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 520);
  }

  // ---------- 기타 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  $$('[data-open-screen]').forEach((b) => b.addEventListener('click', () => openScreen(b.dataset.openScreen)));
  $$('[data-close-screen]').forEach((b) => b.addEventListener('click', () => history.back()));
  $('#draw').addEventListener('click', draw);
  for (const cfg of LISTS) {
    if (cfg.more) $(cfg.more).addEventListener('click', () => { SHOWN[cfg.scope] += PAGE; renderLists(); });
  }
  $('#map-toggle').addEventListener('click', () => toggleMapBig());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.selected) (isDesktop() ? closeCard() : history.back());
    else if (openScreenId) history.back();
    else if (mapBig) toggleMapBig(false);
  });

  async function load() {
    initMap();
    update();
    try {
      const r = await fetch('/api/places');
      const j = await r.json();
      state.places = Array.isArray(j.places) ? j.places : [];
      for (const p of state.places) {
        p.customers = Array.isArray(p.customers) ? p.customers : [];
        p.groups = new Set(p.customers.map(groupOf).filter(Boolean));
        if (kp[p.id]) applyRefine(p, kp[p.id]);
      }
      state.failed = !state.places.length;
    } catch {
      state.failed = true;
    }
    state.loaded = true;
    update();
    refitMap(); // 레이아웃이 잡힌 뒤 지도 크기를 다시 재고 핀 범위를 맞춘다
    const want = new URLSearchParams(location.search).get('p');
    if (want) {
      const p = state.places.find((x) => x.id === want);
      if (p) {
        if (!isDesktop()) history.replaceState({}, '', location.pathname);
        openCard(p, { fromShare: true });
      }
    }
  }
  load();
})();
