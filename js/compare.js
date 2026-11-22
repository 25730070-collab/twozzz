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
    <div class="rt-hd"><i class="rdot ${st.type}" aria-hidden="true"></i><b>${TYPE_LABEL[st.type]}</b>${st.type === 'safe' ? (res.same ? '<span class="chip">빠른 경로와 같아요</span>' : '<span class="chip on">추천</span>') : ''}</div>
    <div class="rt-stats">
      <div><b>${st.minutes}분</b><span class="mu">소요 시간</span></div>
      <div><b>${st.km}km</b><span class="mu">거리</span></div>
      <div><b>${st.hazards.length}곳</b><span class="mu">다발지점</span></div>
    </div>
    <div class="stat"><span class="nm">지나는 사고</span><span class="bar"><i style="width:${Math.round(st.score / max * 100)}%"></i></span><span class="v">${st.score}건</span></div>
    <p class="mu">${names ? '주요 지점 · ' + names : '지나는 사고 다발지점이 없어요'}</p></label>`;
}

function render() {
  const F = res.fast, S = res.safe, max = Math.max(F.score, S.score, 1);
  $('#routeCards').innerHTML = card(F, max) + card(S, max);
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
  $('#candBox').hidden = false;
}

async function run() {
  $('#summary').textContent = `${o} → ${d}`;
  $('#state-loading').classList.add('on');
  try { res = await buildRoutes(o, d, m => { $('#stageText').textContent = m; }); } catch (e) { return failView(e); }
  $('#state-loading').classList.remove('on');
  addRecentRoute(o, d);                                   // 경로를 만든 검색만 최근 검색에 기록
  const F = res.fast, S = res.safe, diff = S.minutes - F.minutes;
  const over = Math.round((CONFIG.SAFE_TIME_LIMIT - 1) * 100);
  if (res.same) {
    $('#verdict').innerHTML = F.hazards.length
      ? `<b>더 안전한 대안 경로를 찾지 못했어요</b><p>길찾기 후보 ${res.count}개를 비교했지만, 빠른 경로보다 ${over}% 넘게 오래 걸리지 않는 선에서 이보다 사고가 적은 길은 없었어요. 이 경로는 사고 다발지점 ${F.hazards.length}곳(사고 ${F.score}건)을 지나요${res.fixed && res.fixed.n ? `. 그중 ${res.fixed.n}곳(사고 ${res.fixed.score}건)은 출발지·도착지 300m 안에 있어 어떤 길로 가도 피하기 어려워요` : ''}</p>`
      : '<b>지나는 사고 다발지점이 없어요</b><p>이 경로 주변에는 데이터에 등록된 사고 다발지점이 없어요</p>';
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
  $('#basis').textContent = `안전 경로는 빠른 경로보다 ${over}% 넘게 오래 걸리지 않는 후보 중, 지나는 사고 다발지점의 사고 건수가 가장 적은 경로예요. 길찾기 후보 ${res.count}개${res.detourCount ? `(위험 지점을 피해 경유지를 둔 우회 경로 ${res.detourCount}개 포함)` : ''}를 비교했어요. 공공 사고 데이터 기준이며 안전을 보장하지는 않아요`;
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
