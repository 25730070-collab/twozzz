/* detail.js — 구간 상세 (공공데이터 값만 표시) */
const q = qs();
(async () => {
const seg = await findSegment(q.get('seg'));
if (!seg) { $('main').innerHTML = emptyState({ title: '구간 정보를 찾을 수 없어요', tips: ['삭제됐거나 데이터가 바뀐 구간일 수 있어요'], actions: [{ href: 'list.html', label: '목록으로' }] }); return; }

$$('.roadName').forEach(el => { el.textContent = seg.roadName; });
$('#accCell').innerHTML = isNil(seg.accidentCount) ? `정보 없음${typeTag('미입력', 'nil')}` : `${seg.accidentCount}건`;
$('#yearCell').innerHTML = isNil(seg.year) ? `정보 없음${typeTag('미입력', 'nil')}` : `${seg.year}년`;
$('.address').innerHTML = infoText(seg.address);
/* 지도 이미지가 없을 때 : 좌표 또는 표준 대체 화면 */
$('#mapView').innerHTML = isNil(seg.lat) || isNil(seg.lng)
  ? `${ico('pin')}위치 정보가 없어요`
  : `${ico('pin')}위도 ${(+seg.lat).toFixed(4)} · 경도 ${(+seg.lng).toFixed(4)}`;
if (!isNil(seg.lat) && !isNil(seg.lng)) {                 // 실제 지도를 불러오면 위 좌표 문구를 지도로 바꾼다 (실패하면 문구 유지)
  const holder = document.createElement('div'); holder.className = 'pinmap'; holder.hidden = true;
  $('#mapView').after(holder);
  createMap(holder, { center: [seg.lat, seg.lng], zoom: 16, dragging: true }).then(m => {
    if (!m) return holder.remove();
    holder.hidden = false; $('#mapView').hidden = true;
    m.L.circleMarker([seg.lat, seg.lng], { radius: 10, color: '#fff', weight: 3, fillColor: RISK_COLOR[seg.riskLevel] || '#5b6560', fillOpacity: 1 }).addTo(m.map);
    m.map.invalidateSize();
  });
}
const badge = $('#riskBadge');
badge.className = `bg r${seg.riskLevel} riskLevel`;
badge.dataset.risk = seg.riskLevel;
badge.textContent = `${seg.riskLevel}등급`;
$('#srcBadge').innerHTML = srcBadge(seg);

/* 응답에 있을 때만 보이는 실제 부가 필드 (없으면 영역 자체를 숨김) */
const EXTRA_LABEL = { casualtyCount: '사상자', deathCount: '사망자', seriousCount: '중상자', minorCount: '경상자', injuryReportCount: '부상신고자' };
const ex = Object.keys(EXTRA_LABEL).filter(k => !isNil(seg[k]));
$('#extraList').innerHTML = ex.map(k => `<div><b>${seg[k]}명</b><span class="mu">${EXTRA_LABEL[k]}</span></div>`).join('');
$('#extraBox').hidden = ex.length === 0;

/* 같은 구의 다른 구간 */
const sameGu = (await loadHazards()).filter(s => s.segmentId !== seg.segmentId && guOf(s) === guOf(seg));
$('#relatedTitle').textContent = `${guOf(seg)}의 다른 구간`;
$('#relatedList').innerHTML = sameGu.slice(0, 8).map(segCard).join('') || '<p class="mu" style="padding:12px 0">같은 지역의 다른 구간이 없어요</p>';

/* 즐겨찾기 (구간) */
const favBtn = $('#favBtn');
const match = f => f.kind === 'segment' && f.segmentId === seg.segmentId;
const paintFav = () => {
  const on = getFavs().some(match);
  favBtn.dataset.fav = String(on);
  favBtn.innerHTML = `${ico('star', on ? 'fill' : '')}${on ? '즐겨찾기 됨' : '구간 즐겨찾기'}`;
};
favBtn.addEventListener('click', () => {
  let favs = getFavs();
  const on = favs.some(match);
  if (on) favs = favs.filter(f => !match(f));
  else favs.unshift({ id: 'fv' + Date.now(), kind: 'segment', segmentId: seg.segmentId, savedAt: nowText().slice(0, 5) });
  store.set(KEY.fav, favs); paintFav();
  toast(on ? '즐겨찾기를 해제했어요' : '즐겨찾기에 저장했어요');
});
paintFav();
})();
