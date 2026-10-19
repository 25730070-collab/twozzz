/* detail.js — 구간 상세 */
const q = qs();
(async () => {
const seg = await findSegment(q.get('seg')) || SEGMENTS[0];

$$('.roadName').forEach(el => { el.textContent = seg.roadName; });
$$('.roadType').forEach(el => { el.textContent = seg.roadType; });
$$('.accidentCount').forEach(el => { el.textContent = seg.accidentCount; });
$('.address').textContent = seg.address;
const badge = $('#riskBadge');
badge.className = `bg r${seg.riskLevel} riskLevel`;
badge.dataset.risk = seg.riskLevel;
badge.textContent = `${seg.riskLevel}등급`;

/* 사고 유형 요약 (샘플: 사고건수에서 비율로 나눔) */
const n = seg.accidentCount, rear = Math.round(n * .5), left = Math.round(n * .3), walk = Math.max(n - rear - left, 0);
$('#typeSummary').textContent = `추돌 ${rear}건 · 좌회전 ${left}건 · 보행자 ${walk}건`;
$('#advice').textContent = adviceOf(seg).text;

/* 이 구간을 지나는 경로 · 같은 구의 다른 구간 */
const through = ROUTES.filter(r => r.segmentIds.includes(seg.segmentId));
$('#throughList').innerHTML = through.map(r => routeCard(r)).join('');
$('#throughBox').hidden = through.length === 0;
const sameGu = SEGMENTS.filter(s => s.segmentId !== seg.segmentId && guOf(s) === guOf(seg));
$('#relatedTitle').textContent = `${guOf(seg)}의 다른 구간`;
$('#relatedList').innerHTML = sameGu.slice(0, 8).map(segCard).join('');
$('#learnList').innerHTML = LEARN.slice(0, 2).map(learnCard).join('');

/* 즐겨찾기 (구간) */
const favBtn = $('#favBtn');
const match = f => f.kind === 'segment' && f.segmentId === seg.segmentId;
const paintFav = () => {
  const on = getFavs().some(match);
  favBtn.dataset.fav = String(on);
  favBtn.textContent = on ? '★ 즐겨찾기 됨' : '☆ 구간 즐겨찾기';
};
favBtn.addEventListener('click', () => {
  let favs = getFavs();
  const on = favs.some(match);
  if (on) favs = favs.filter(f => !match(f));
  else favs.unshift({ id: 'fv' + Date.now(), kind: 'segment', segmentId: seg.segmentId, savedAt: nowText().slice(0, 5) });
  store.set(KEY.fav, favs); paintFav();
  const done = $('#state-save-done'), msg = $('p', done);
  msg.textContent = on ? '즐겨찾기를 해제했어요' : '즐겨찾기에 저장했어요';
  done.classList.add('on'); setTimeout(() => done.classList.remove('on'), 1800);
});
paintFav();
})();
