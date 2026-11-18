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
  const REGION_NAME = { seo: '서여의도', center: '더현대·IFC', dong: '동여의도' };
  const PAGE = 20;

  const state = {
    places: [],
    loaded: false,
    failed: false,
    region: 'all',
    kind: 'meal',
    moods: new Set(['lunch']),
    shown: PAGE,
    selected: null,
    lastPick: null
  };

  const $ = (s) => document.querySelector(s);
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
  const svgUse = (cls) => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(ns, 'use'); u.setAttribute('href', '#dori'); s.append(u);
    return s;
  };
  const icon = (d) => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  };
  const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);

  function filtered() {
    return state.places.filter((p) => {
      if (state.region !== 'all' && p.region !== state.region) return false;
      if (state.kind !== 'all' && p.kind !== state.kind) return false;
      for (const m of state.moods) if (!p[m]) return false;
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

  // ---------- 필터 ----------
  function renderFilters() {
    const regions = $('#regions'); regions.replaceChildren();
    for (const r of REGIONS) {
      regions.append(el('button', {
        class: 'region', type: 'button', 'aria-pressed': String(state.region === r.id),
        onclick: () => { state.region = r.id; state.shown = PAGE; update(); }
      }, el('b', {}, r.label), el('small', {}, r.sub)));
    }
    const kinds = $('#kinds'); kinds.replaceChildren();
    for (const k of KINDS) {
      kinds.append(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(state.kind === k.id),
        onclick: () => { state.kind = k.id; state.shown = PAGE; update(); }
      }, k.label));
    }
    const moods = $('#moods'); moods.replaceChildren();
    for (const m of MOODS) {
      const on = state.moods.has(m.id);
      moods.append(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(on),
        onclick: () => { on ? state.moods.delete(m.id) : state.moods.add(m.id); state.shown = PAGE; update(); }
      }, m.label));
    }
  }

  // ---------- 목록 ----------
  function renderList() {
    const list = $('#list'); list.replaceChildren();
    const more = $('#more');
    const regionLabel = REGIONS.find((r) => r.id === state.region).label;
    if (!state.loaded) {
      $('#result-title').textContent = '불러오는 중…';
      for (let i = 0; i < 4; i++) list.append(el('li', { class: 'skeleton', 'aria-hidden': 'true' }));
      more.hidden = true; return;
    }
    if (state.failed) {
      $('#result-title').textContent = '앗, 잠깐만요';
      list.append(el('li', { class: 'empty' }, '지금은 맛집 정보를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
      more.hidden = true; return;
    }
    const items = filtered();
    $('#result-title').textContent = `${regionLabel} ${items.length}곳`;
    if (!items.length) {
      list.append(el('li', { class: 'empty' }, '이 조건에 맞는 집이 없어요. 조건을 하나 빼 보세요.'));
      more.hidden = true; return;
    }
    items.slice(0, state.shown).forEach((p, i) => {
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
    more.hidden = items.length <= state.shown;
  }

  function update() { renderFilters(); renderList(); }

  // ---------- 맛집 카드 ----------
  const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

  function shareUrl(p) { return `${location.origin}/?p=${encodeURIComponent(p.id)}`; }
  function kakaoMapUrl(p) { return `https://map.kakao.com/?q=${encodeURIComponent(p.name)}`; }

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

  function eatLink(p, label) {
    // 잇플로 보내는 링크: 순 사용자 집계를 위해 referrer 를 지우지 않는다(noreferrer 금지).
    return el('a', { class: 'btn-eat', href: p.url, target: '_blank', rel: 'noopener' }, label || 'eat.pl에서 자세히 보기');
  }

  function cardBody(p) {
    const facts = [];
    if (p.hours) facts.push(['영업 예상 시간', p.hours]);
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
      el('h2', { class: 'card-name', id: 'card-name' }, p.name),
      el('div', { class: 'stats' },
        el('div', { class: 'stat hot' }, el('small', {}, '전국 매출 상위'), el('b', {}, pct(p.nat))),
        el('div', { class: 'stat' }, el('small', {}, '지역 매출 상위'), el('b', {}, pct(p.loc)))
      ),
      el('dl', { class: 'facts' }, facts.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v)))),
      el('p', { class: 'note' }, '순위는 최근 1개월 BC카드 결제 데이터 기준이에요. 영업 예상 시간은 결제 시각으로 추정한 값이라 공식 영업시간이 아니에요. · eat.pl 잇플 · BC카드 결제 데이터 기반')
    );
  }

  function openCard(p, { fromShare = false } = {}) {
    state.selected = p;
    const pane = $('#pane');
    pane.replaceChildren(el('div', { class: 'pane-inner' },
      el('div', { class: 'pane-top' },
        el('button', { class: 'icon-btn btn-back', type: 'button', 'aria-label': '목록으로', onclick: closeCard }, icon('M15 5l-7 7 7 7')),
        el('span', { class: 'jua' }, fromShare ? '친구가 보낸 도시락' : '도시락 뚜껑 열기'),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '공유하기', onclick: () => share(p) }, icon('M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13'))
      ),
      el('div', { class: 'lid' }, svgUse('dori')),
      cardBody(p),
      el('div', { class: 'actions' },
        eatLink(p),
        el('a', { class: 'btn-sub', href: kakaoMapUrl(p), target: '_blank', rel: 'noopener' }, '카카오맵에서 메뉴 · 후기 보기'),
        el('button', { class: 'btn-sub', type: 'button', onclick: () => share(p) }, '단톡방에 "오늘 여기 어때?" 보내기')
      )
    ));
    pane.hidden = false;
    pane.scrollTop = 0;
    if (!isDesktop()) {
      document.body.style.overflow = 'hidden';
      history.pushState({ card: p.id }, '', `?p=${encodeURIComponent(p.id)}`);
      pane.querySelector('.btn-back').focus();
    } else {
      history.replaceState({ card: p.id }, '', `?p=${encodeURIComponent(p.id)}`);
    }
    renderList();
  }

  function closeCard(fromPop) {
    state.selected = null;
    document.body.style.overflow = '';
    if (isDesktop()) { renderEmptyPane(); }
    else { $('#pane').hidden = true; }
    if (fromPop !== true) history.replaceState({}, '', location.pathname);
    renderList();
  }

  function renderEmptyPane() {
    const pane = $('#pane');
    pane.replaceChildren(el('div', { class: 'pane-inner', style: 'justify-content:center;align-items:center;text-align:center;gap:12px' },
      svgUse('dori'),
      el('p', { class: 'jua', style: 'font-size:22px;margin:0' }, '왼쪽에서 도시락을 골라 보세요'),
      el('p', { class: 'muted', style: 'margin:0' }, '고민되면 오른쪽 위 제비뽑기!')
    ));
    pane.querySelector('svg').style.cssText = 'width:96px;height:96px';
  }

  window.addEventListener('popstate', () => {
    if (!isDesktop() && !$('#pane').hidden) closeCard(true);
    if (!$('#pick').hidden) closePick(true);
  });

  // ---------- 제비뽑기 ----------
  function pool() {
    const items = filtered();
    return (items.length ? items : state.places).slice(0, 30);
  }

  function openPick() {
    const pick = $('#pick');
    pick.hidden = false;
    document.body.style.overflow = 'hidden';
    const n = pool().length;
    const regionLabel = REGIONS.find((r) => r.id === state.region).label;
    $('#pick-scope').textContent = state.loaded ? `지금 조건(${regionLabel})의 매출 상위 ${n}곳 중에서 뽑아요` : '맛집 정보를 불러오는 중이에요';
    $('#pick-result').replaceChildren();
    $('#cup').classList.remove('picked');
    $('#draw').textContent = '젓가락 뽑기!';
    history.pushState({ pick: true }, '', location.search || location.pathname);
    $('[data-close-pick]').focus();
  }

  function closePick(fromPop) {
    $('#pick').hidden = true;
    if ($('#pane').hidden || isDesktop()) document.body.style.overflow = '';
    if (fromPop !== true) history.back();
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
          eatLink(p, 'eat.pl에서 보기'),
          el('button', { class: 'btn-sub', type: 'button', onclick: () => share(p, '제비뽑기 결과 나왔다!') }, '단톡방에 보내기'),
          el('button', { class: 'btn-sub', type: 'button', onclick: () => { closePick(); setTimeout(() => openCard(p), 300); } }, '카드 보기')
        )
      ));
      $('#draw').textContent = '다시 뽑기';
    }, 520);
  }

  // ---------- 기타 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  document.querySelectorAll('[data-open-pick]').forEach((b) => b.addEventListener('click', openPick));
  $('[data-close-pick]').addEventListener('click', () => closePick());
  $('#draw').addEventListener('click', draw);
  $('#more').addEventListener('click', () => { state.shown += PAGE; renderList(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#pick').hidden) closePick();
    else if (state.selected && !isDesktop()) history.back();
  });

  async function load() {
    update();
    if (isDesktop()) renderEmptyPane();
    try {
      const r = await fetch('/api/places');
      const j = await r.json();
      state.places = Array.isArray(j.places) ? j.places : [];
      state.failed = !state.places.length;
    } catch {
      state.failed = true;
    }
    state.loaded = true;
    update();
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
