/* compare.js — 빠른 경로 vs 안전 경로 (실제 길찾기 경로 + 실제 사고 다발지점) */
const q = qs();
const o = q.get('origin'), d = q.get('destination');
let sel = 'safe', res = null;

if (!o || !d) { $('main').innerHTML = emptyState({ title: '출발지와 도착지를 입력해 주세요', tips: ['홈에서 출발지와 도착지를 입력하면 경로를 비교해 드려요'], actions: [{ href: '../index.html', label: '홈으로' }] }); }
else run();

function card(st, max) {
  const names = [...st.hazards].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount).slice(0, 3).map(h => esc(h.seg.roadName)).join(' · ');
  return `<label class="rt-card ${sel === st.type ? 'on' : ''}" data-type="${st.type}">
    <input type="radio" name="routeType" value="${st.type}" ${sel === st.type ? 'checked' : ''}>
    <div class="rt-hd"><b>${TYPE_LABEL[st.type]}</b>${st.type === 'safe' && !res.same ? '<span class="chip on">추천</span>' : ''}</div>
    <div class="rt-stats">
      <div><b>${st.minutes}분</b><span class="mu">소요 시간</span></div>
      <div><b>${st.km}km</b><span class="mu">거리</span></div>
      <div><b>${st.hazards.length}곳</b><span class="mu">사고 다발지점</span></div>
    </div>
    <div class="stat"><span class="nm">지나는 사고</span><span class="bar"><i style="width:${Math.round(st.score / max * 100)}%"></i></span><span class="v">${st.score}건</span></div>
    <p class="mu">${names ? '주요 지점 · ' + names : '지나는 사고 다발지점이 없어요'}</p></label>`;
}

function render() {
  const F = res.fast, S = res.safe, max = Math.max(F.score, S.score, 1);
  $('#routeCards').innerHTML = card(F, max) + card(S, max);
  $('#goPreview').href = previewUrl({ origin: o, destination: d }, sel);
  $('#goDrive').href = driveUrl({ origin: o, destination: d }, sel);
}

async function run() {
  $('#summary').textContent = `${o} → ${d}`;
  $('#state-loading').classList.add('on');
  try { res = await buildRoutes(o, d); } catch (e) { return failView(e); }
  $('#state-loading').classList.remove('on');
  const F = res.fast, S = res.safe, diff = S.minutes - F.minutes;
  $('#verdict').innerHTML = res.same
    ? (F.hazards.length ? `더 안전한 대안 경로가 없어요. 이 경로는 사고 다발지점 <b>${F.hazards.length}곳</b>(사고 ${F.score}건)을 지나요` : '이 경로 주변에는 데이터에 등록된 사고 다발지점이 없어요')
    : `안전 경로는 ${diff > 0 ? `<b>+${diff}분</b> 더 걸리지만` : '시간 차이 없이'} 지나는 사고가 <b>${F.score}건 → ${S.score}건</b>으로 줄어요`;
  $('#verdict').hidden = false;
  $('#basis').hidden = false;

  const worst = [...F.hazards, ...S.hazards.filter(h => !F.hazards.some(x => x.seg.segmentId === h.seg.segmentId))].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount).slice(0, 3);
  $('#worstList').innerHTML = worst.map(h => `<div class="card" data-href="${segUrl(h.seg.segmentId)}"><div><b class="roadName">${esc(h.seg.roadName)}</b>
      <p class="mu">${guOf(h.seg)} · 사고 ${h.seg.accidentCount}건</p></div><span class="mu">›</span></div>`).join('');
  $('#worstBox').hidden = worst.length === 0;
  render();
}

document.addEventListener('change', e => {
  if (e.target.name === 'routeType' && res) { sel = e.target.value; render(); }
});
