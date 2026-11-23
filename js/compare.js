/* compare.js — 빠른 경로 vs 안전 경로 (실제 길찾기 경로 + 실제 사고 다발지점) */
const q = qs();
const o = q.get('origin'), d = q.get('destination');
let sel = 'safe', res = null;

if (!o || !d) { $('main').innerHTML = emptyState({ title: '출발지와 도착지를 입력해 주세요', tips: ['홈에서 출발지와 도착지를 입력하면 경로를 비교해 드려요'], actions: [{ href: '../index.html', label: '홈으로' }] }); }
else run();

/* 두 경로를 좌우로 나란히: 안전 경로(추천)를 왼쪽에, 스크롤 없이 한 화면에서 고르게 한다 */
function card(st, max) {
  const tag = st.type === 'safe' ? (res.same ? '<span class="chip">빠른 경로와 같아요</span>' : '<span class="chip on">추천</span>') : '';
  return `<label class="rt-card ${sel === st.type ? 'on' : ''}" data-type="${st.type}">
    <input type="radio" name="routeType" value="${st.type}" ${sel === st.type ? 'checked' : ''}>
    <div class="rt-hd"><i class="rdot ${st.type}" aria-hidden="true"></i><b>${TYPE_LABEL[st.type]}</b></div>
    <div class="rt-tag">${tag}</div>
    <div class="rt-big"><b>${st.minutes}</b><span>분</span></div>
    <dl class="rt-dl">
      <div><dt>거리</dt><dd>${st.km}km</dd></div>
      <div><dt>다발지점</dt><dd>${st.hazards.length}곳</dd></div>
      <div><dt>지나는 사고</dt><dd>${st.score}건</dd></div>
    </dl>
    <span class="bar rt-bar"><i style="width:${Math.round(st.score / max * 100)}%"></i></span></label>`;
}
/* 선택한 경로가 지나는 주요 사고 다발지점 */
function names(st) {
  const n = [...st.hazards].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount).slice(0, 3).map(h => esc(h.seg.roadName)).join(' · ');
  const nm = res.same ? '이 경로' : TYPE_LABEL[st.type];
  return n ? `<b>${nm}</b>의 주요 지점 · ${n}` : '';
}

function render() {
  const F = res.fast, S = res.safe, max = Math.max(F.score, S.score, 1);
  if (res.same) { sel = 'safe'; $('#routeCards').innerHTML = ''; }                // 같은 경로면 고를 게 없다: 설명 상자에 합쳐 보여 준다
  else $('#routeCards').innerHTML = card(S, max) + card(F, max);              // 안전 경로가 왼쪽(먼저)
  $('#selNames').innerHTML = names(sel === 'safe' ? S : F);
  $('#ctaBar').hidden = false;   // 경로를 불러왔을 때만 예습·안내 버튼을 보여 준다
  $('#goPreview').href = previewUrl({ origin: o, destination: d }, sel);
  $('#goDrive').href = driveUrl({ origin: o, destination: d }, sel);
  if (cmp) cmp.update(sel);
}

/* 지도 : 두 경로를 겹쳐 보여 준다 (지도를 못 불러오면 숨김). 선을 누르면 그 경로가 선택된다 */
let cmp = null;
async function paintMap() {
  const el = $('#cmpMap'); el.hidden = false;
  const m = await createMap(el, { center: res.fast.path[0], zoom: 12, lite: true });
  if (!m) { el.hidden = true; return; }
  el.classList.remove('skel'); m.map.invalidateSize();
  cmp = drawCompare(m, res.fast, res.safe, res.same, type => { sel = type; render(); });
  cmp.update(sel);
}

/* 비교한 후보 경로 전부와, 각각이 왜 안전 경로로 뽑히거나 빠졌는지 */
function paintCandidates() {
  const F = res.fast, list = res.candidates || [];
  if (!list.length) return;
  let nb = 0, nd = 0;
  const why = c => c.isFast && c.isSafe ? '빠른 경로 · 안전 경로' : c.isSafe ? '안전 경로로 선택' : c.isFast ? '빠른 경로' : c.over ? `시간 초과 (${res.limitMinutes}분 넘음)` : c.score >= F.score ? '사고가 줄지 않음' : '더 안전한 후보가 있음';
  $('#candList').innerHTML = list.map(c => {
    const name = c.via ? `우회 경로 ${++nd}` : `기본 경로 ${++nb}`;
    return `<li class="${c.isSafe ? 'on' : ''}"><div><b>${name}</b><span class="mu">${c.minutes}분 · ${c.km}km</span></div>
      <div class="r"><b>${c.hazards}곳 · ${c.score}건</b><span class="mu">${why(c)}</span></div></li>`;
  }).join('');
  $('#candBox').querySelector('summary').textContent = `비교한 후보 경로 ${list.length}개 보기`;
  $('#candBox').hidden = false;
}

async function run() {
  $('#summary').textContent = `${o} → ${d}`;
  $('#state-loading').classList.add('on');
  try { res = await buildRoutes(o, d, m => { $('#stageText').textContent = m; }); } catch (e) { return failView(e); }
  $('#state-loading').classList.remove('on');
  addRecentRoute(o, d);                                   // 경로를 만든 검색만 최근 검색에 기록
  const F = res.fast, S = res.safe, diff = S.minutes - F.minutes;
    if (res.same) {
    const fx = res.fixed && res.fixed.n;
    $('#verdict').innerHTML = F.hazards.length
      ? `<b>더 안전한 길을 찾지 못했어요</b>
        <p>다른 길도 비교해 봤지만, 이 길보다 사고가 적으면서 많이 돌아가지 않는 길은 없었어요.${fx ? ` 사고 다발지점 ${fx}곳은 출발지·도착지 근처라 어떤 길로 가도 지나요.` : ''}</p>
        <div class="delta"><div><b>${F.minutes}분</b><span>소요 시간</span></div><div><b>${F.km}km</b><span>거리</span></div><div><b>${F.hazards.length}곳 · ${F.score}건</b><span>지나는 사고</span></div></div>`
      : `<b>지나는 사고 다발지점이 없어요</b><p>이 길 주변에는 등록된 사고 다발지점이 없어요.</p>
        <div class="delta"><div><b>${F.minutes}분</b><span>소요 시간</span></div><div><b>${F.km}km</b><span>거리</span></div></div>`;
  } else {
    const dh = F.hazards.length - S.hazards.length, ds = F.score - S.score;
    $('#verdict').innerHTML = `<b>안전 경로가 더 안전해요</b>
      <div class="delta">
        <div><b>${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}분</b><span>소요 시간</span></div>
        <div class="good"><b>−${dh}곳</b><span>다발지점</span></div>
        <div class="good"><b>−${ds}건</b><span>지나는 사고</span></div>
      </div>`;
  }
  $('#verdict').hidden = false;
  $('#basis').textContent = `안전 경로는 시간이 많이 늘지 않는 길 중 사고 기록이 가장 적은 길이에요. ${DATA_STATUS.year ? DATA_STATUS.year + '년 ' : ''}공공 사고 데이터 기준이며 안전을 보장하지는 않아요.`;
  $('#basis').hidden = false;
  paintCandidates();
  paintMap();

  const worst = [...F.hazards, ...S.hazards.filter(h => !F.hazards.some(x => x.seg.segmentId === h.seg.segmentId))].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount).slice(0, 3);
  $('#worstList').innerHTML = worst.map(h => `<div class="card" data-href="${segUrl(h.seg.segmentId)}"><div><b class="roadName">${esc(h.seg.roadName)}</b>
      <p class="mu">${guOf(h.seg)} · 사고 ${h.seg.accidentCount}건</p></div><span class="go">${ico('next', 's')}</span></div>`).join('');
  $('#worstBox').hidden = worst.length === 0;
  render();
}

const favBtn = $('#favRoute');   // 경로를 못 불러와 실패 화면으로 바뀌면 버튼이 없을 수 있다
const paintFav = () => { if (!favBtn) return; const on = isRouteFav(o, d); favBtn.dataset.fav = String(on); favBtn.classList.toggle('on', on); favBtn.innerHTML = `${ico('star', on ? 'fill' : '')}${on ? '즐겨찾기 됨' : '경로 즐겨찾기'}`; };
if (favBtn) favBtn.addEventListener('click', () => { const on = toggleRouteFav(o, d); paintFav(); toast(on ? '즐겨찾기에 저장했어요' : '즐겨찾기를 해제했어요'); });
if (o && d) paintFav();
const shareBtn = $('#shareRoute');
if (shareBtn) {
  shareBtn.innerHTML = `${ico('share')}공유`; shareBtn.classList.add('fav-btn');
  shareBtn.addEventListener('click', async () => {
    const url = location.href;
    try { if (navigator.share) { await navigator.share({ title: `Safe Drive · ${o} → ${d}`, text: `${o}에서 ${d}까지 안전 경로 비교`, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); } catch { toast('링크를 복사하지 못했어요'); }
  });
}
document.addEventListener('change', e => {
  if (e.target.name === 'routeType' && res) { sel = e.target.value; render(); }
});
