/* preview.js — 가는 길 예습(연습): 경로에서 지나는 사고 다발지점을 주행 순서대로 (모두 공공데이터 값) */
const q = qs();
const o = q.get('origin'), d = q.get('destination');
let type = q.get('type') === 'fast' ? 'fast' : 'safe', res = null;
const EXTRA_LABEL = { casualtyCount: '사상자', deathCount: '사망', seriousCount: '중상', minorCount: '경상', injuryReportCount: '부상신고' };

function detailText(s) {
  const ex = Object.keys(EXTRA_LABEL).filter(k => !isNil(s[k]) && s[k] > 0).map(k => `${EXTRA_LABEL[k]} ${s[k]}명`);
  return ex.length ? ex.join(' · ') : '';
}

let pvm = null, pvLayers = [];
async function paintMap(st) {                          // 실제 지도에 경로와 다발지점을 그린다 (지도를 못 불러오면 숨김)
  const el = $('#pvMap');
  if (!pvm) { el.hidden = false; pvm = await createMap(el, { center: st.path[0], zoom: 13 }); if (!pvm) { el.hidden = true; return; } }
  pvLayers.forEach(l => l.remove()); pvLayers = [];
  const { L, map } = pvm, before = new Set();
  map.eachLayer(l => before.add(l));
  drawRoute(pvm, st, h => { location.href = segUrl(h.seg.segmentId); });
  map.eachLayer(l => { if (!before.has(l)) pvLayers.push(l); });
  map.invalidateSize();
}

function render() {
  if (!res) return;
  const st = res[type];
  $('#headerTitle').textContent = `${o} → ${d}`;
  $$('#typeTabs button').forEach(b => { const on = b.dataset.type === type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('#pvStats').innerHTML = `
    <div><b>${st.minutes}분</b><span class="mu">소요 시간</span></div>
    <div><b>${st.km}km</b><span class="mu">거리</span></div>
    <div><b>${st.hazards.length}곳</b><span class="mu">다발지점</span></div>
    <div><b>${st.score}건</b><span class="mu">지나는 사고</span></div>`;
  $('#timeline').innerHTML = st.hazards.map((h, i) => {
    const s = h.seg, dt = detailText(s);
    return `<div class="tl-item" data-href="${segUrl(s.segmentId)}">
      <span class="tl-n r${s.riskLevel}">${i + 1}</span>
      <div><div class="tl-top"><b class="roadName">${esc(s.roadName)}</b></div>
        <p class="mu">출발 후 ${(h.at / 1000).toFixed(1)}km · ${guOf(s)} · 사고 ${s.accidentCount}건${isNil(s.year) ? '' : ` (${s.year}년)`}</p>
        ${dt ? `<p class="mu">${dt}</p>` : ''}${pntBrief(s) ? `<p class="mu">${esc(pntBrief(s))}</p>` : ''}</div></div>`;
  }).join('') || '<p class="mu" style="padding:14px 0">이 경로에는 등록된 사고 다발지점이 없어요</p>';
  paintMap(st);
  $('#goDrive').href = driveUrl({ origin: o, destination: d }, type);
  history.replaceState(null, '', `?${pair(o, d)}&type=${type}`);
}

$('#typeTabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  type = b.dataset.type; render();
});

if (!o || !d) { $('main').innerHTML = emptyState({ title: '출발지와 도착지를 입력해 주세요', actions: [{ href: '../index.html', label: '홈으로' }] }); }
else {
  $('#state-loading').classList.add('on');
  buildRoutes(o, d).then(r => { res = r; $('#state-loading').classList.remove('on'); render(); }).catch(failView);
}
