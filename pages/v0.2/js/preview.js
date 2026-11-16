/* preview.js — 가는 길 예습: 주행 순서대로 주의 지점 + 대처법 */
const q = qs();
const o = q.get('origin') || ROUTES[0].origin, d = q.get('destination') || ROUTES[0].destination;
let type = q.get('type') === 'fast' ? 'fast' : 'safe', res = null;
const favMatch = f => f.kind === 'route' && f.origin === o && f.destination === d;

function render() {
  if (!res) return;
  const st = res[type];
  $('#headerTitle').textContent = `${o} → ${d}`;
  $$('#typeTabs button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  $('#pvStats').innerHTML = `
    <div><b>${st.minutes}분</b><span class="mu">소요 시간</span></div>
    <div><b>${st.km}km</b><span class="mu">거리</span></div>
    <div><b>${st.high}곳</b><span class="mu">3~4등급</span></div>
    <div><b>${st.score}</b><span class="mu">위험 점수</span></div>`;
  $('#timeline').innerHTML = st.hazards.map((h, i) => {
    const s = h.seg, a = adviceOf(s);
    return `<div class="tl-item" data-href="${segUrl(s.segmentId)}">
      <span class="tl-n r${s.riskLevel}">${i + 1}</span>
      <div><div class="tl-top"><b class="roadName">${esc(s.roadName)}</b>${levelBadge(s.riskLevel)}</div>
        <p class="mu">출발 후 ${(h.at / 1000).toFixed(1)}km · ${s.roadType} · 사고 ${s.accidentCount}건</p>
        <p class="advice">${a.text}</p></div></div>`;
  }).join('') || '<p class="mu" style="padding:14px 0">이 경로에는 알려진 위험 구간이 없어요</p>';
  $('#goDrive').href = driveUrl({ origin: o, destination: d }, type);
  history.replaceState(null, '', `?${pair(o, d)}&type=${type}`);
}

$('#typeTabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  type = b.dataset.type; render();
});

const chks = $$('.chk input');
const syncChk = () => { $('#chkCount').textContent = `${chks.filter(c => c.checked).length}/${chks.length}`; };
chks.forEach(c => c.addEventListener('change', syncChk));

const favBtn = $('#favBtn');
const paintFav = () => {
  const on = getFavs().some(favMatch);
  favBtn.dataset.fav = String(on);
  favBtn.textContent = on ? '★ 즐겨찾기 됨' : '☆ 즐겨찾기';
};
favBtn.addEventListener('click', () => {
  let favs = getFavs();
  const on = favs.some(favMatch);
  if (on) favs = favs.filter(f => !favMatch(f));
  else favs.unshift({ id: 'fv' + Date.now(), kind: 'route', origin: o, destination: d, savedAt: nowText().slice(0, 5) });
  store.set(KEY.fav, favs); paintFav();
  const done = $('#state-save-done'), msg = $('p', done);
  msg.textContent = on ? '즐겨찾기를 해제했어요' : '즐겨찾기에 저장했어요';
  done.classList.add('on'); setTimeout(() => done.classList.remove('on'), 1800);
});

$('#tipList').innerHTML = TIPS.map(tipCard).join('');
paintFav(); syncChk();
$('#state-loading').classList.add('on');
buildRoutes(o, d).then(r => { res = r; $('#state-loading').classList.remove('on'); render(); });
