/* route.js — 경로 찾기 탭: 출발지·도착지 입력 → compare.html. 최근 경로·즐겨찾기 경로는 이 기기에 저장된 기록만 보여준다 */
const ro = $('#ro'), rd = $('#rd'), goRoute = $('#goRoute');
const syncRoute = () => { goRoute.disabled = !(ro.value.trim() && rd.value.trim()); };
[ro, rd].forEach(el => { el.addEventListener('input', syncRoute); el.addEventListener('keydown', e => { if (e.key === 'Enter' && !goRoute.disabled) goRoute.click(); }); });
attachSuggest(ro, { onPick: () => { if (!rd.value.trim()) rd.focus(); } }); attachSuggest(rd);
$('#useMe').addEventListener('click', () => { ro.value = '내 위치'; syncRoute(); rd.focus(); });
goRoute.addEventListener('click', () => { location.href = `${BASE}compare.html?${pair(ro.value.trim(), rd.value.trim())}`; });

function paintRecent() {
  const recent = getRecent().filter(r => r.kind === 'route').slice(0, 5);
  $('#recentRoutes').innerHTML = recent.map(r => routeCard(r, `· ${esc(r.at || '')}`)).join('');
  $('#recentBox').hidden = !recent.length;
}
paintRecent(); syncDown().then(ok => { if (ok) paintRecent(); });          // 먼저 이 기기 것을 보여 주고, 로그인 중이면 서버 것을 받아 다시 그린다

const favs = getFavs().filter(f => f.kind === 'route').slice(0, 5);
$('#favRoutes').innerHTML = favs.map(f => routeCard(f)).join('');
$('#favBox').hidden = !favs.length;
