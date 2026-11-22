/* detail.js — 구간 상세 (공공데이터 값만 표시) */
const q = qs();
(async () => {
const seg = await findSegment(q.get('seg'));
if (!seg) { $('main').innerHTML = emptyState({ title: '구간 정보를 찾을 수 없어요', tips: ['삭제됐거나 데이터가 바뀐 구간일 수 있어요'], actions: [{ href: 'list.html', label: '목록으로' }] }); return; }

$$('.roadName').forEach(el => { el.textContent = seg.roadName; });
$('#accCell').innerHTML = isNil(seg.accidentCount) ? `정보 없음${typeTag('미입력', 'nil')}` : `${seg.accidentCount}건`;
$('#yearCell').innerHTML = isNil(seg.year) ? `정보 없음${typeTag('미입력', 'nil')}` : `${seg.year}년`;
$('.address').innerHTML = infoText(seg.address);
/* 지도 : 가장 위. 불러오는 동안 자리를 먼저 잡아 두고(깜빡임 방지), 못 불러오면 좌표 안내 카드를 보여 준다 */
$('#mapView').innerHTML = isNil(seg.lat) || isNil(seg.lng)
  ? `${ico('pin')}위치 정보가 없어요`
  : `${ico('pin')}위도 ${(+seg.lat).toFixed(4)} · 경도 ${(+seg.lng).toFixed(4)}`;
if (!isNil(seg.lat) && !isNil(seg.lng)) {
  const hero = $('#heroMap'); hero.hidden = false; $('#mapView').hidden = true;
  createMap(hero, { center: [seg.lat, seg.lng], zoom: 15.5, lite: true }).then(async m => {
    if (!m) { hero.hidden = true; $('#mapView').hidden = false; return; }          // 실패하면 좌표 문구로 되돌린다
    hero.classList.remove('skel');
    const near = (await loadHazards()).filter(s => s.segmentId !== seg.segmentId && !isNil(s.lat) && !isNil(s.lng) && hav([seg.lat, seg.lng], [+s.lat, +s.lng]) <= 1000);
    near.forEach(s => hazardDot(m, s, { radius: 6 }));
    hazardDot(m, seg, { current: true });
    const cap = $('#heroCap'); cap.textContent = near.length ? `주변 1km 다발지점 ${near.length}곳` : '주변 1km에 다른 다발지점 없음'; cap.hidden = false;
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

/* 사고 유형 · 인명 피해 (국토교통부 사고다발지점, 구간 좌표 150m 안에서 가장 가까운 지점) */
if (seg.pnt && seg.pnt.detail) {
  const p = seg.pnt, dt = p.detail, types = Object.entries(dt.types || {}).sort((a, b) => b[1] - a[1]), top = types.length ? types[0][1] : 1;
  $('#pntTypes').innerHTML = types.slice(0, 6).map(([n, c]) => `<div class="tb"><span class="tn">${esc(n)}</span><span class="tv">${c}건</span><span class="bar"><i style="width:${Math.max(c / top * 100, 4)}%"></i></span></div>`).join('')
    || '<p class="mu">사고 유형 정보가 없어요</p>';
  $('#pntCas').innerHTML = PNT_SUM.map(([k, l]) => `<div><b>${dt[k] ?? 0}명</b><span class="mu">${l}</span></div>`).join('');
  $('#pntNote').textContent = `국토교통부 사고다발지점 「${p.name}」 기준 · ${p.year}년까지 과거 3년 · 개별 사고 ${dt.accidents}건 · 이 구간에서 약 ${p.distM}m`;
  const tip = pntAdvice(seg), topName = types.length ? types[0][0].split(' · ').pop() : '';
  if (tip) { $('#pntTip').textContent = `운전 팁 · ${tip} (가장 많은 사고 유형: ${topName})`; $('#pntTip').hidden = false; }
  $('#pntBox').hidden = false;
}

/* 출처 한 줄 (구간 데이터의 종류에 맞게) */
$('#metaSum').textContent = seg.source === 'user'
  ? '사용자가 제보한 구간이에요. 확인되지 않은 정보일 수 있어요'
  : '사고 건수 출처 · 도로교통공단 지자체별 교통사고 다발지역. 위험등급은 수집한 구간의 사고 건수를 비교한 상대 등급이에요';

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
