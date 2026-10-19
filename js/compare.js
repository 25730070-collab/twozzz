/* compare.js — 빠른 경로 vs 안전 경로 비교 (라이브: 카카오 API / 데모: 샘플) */
const q = qs();
const o = q.get('origin') || ROUTES[0].origin, d = q.get('destination') || ROUTES[0].destination;
let sel = 'safe', res = null;

$('#summary').textContent = `${o} → ${d}`;
$('#state-loading').classList.add('on');

function card(st, maxScore) {
  const names = [...st.hazards].sort((a, b) => b.seg.riskLevel - a.seg.riskLevel).slice(0, 3).map(h => esc(h.seg.roadName)).join(' · ') || '3~4등급 구간 없음';
  return `<label class="rt-card ${sel === st.type ? 'on' : ''}" data-type="${st.type}">
    <input type="radio" name="routeType" value="${st.type}" ${sel === st.type ? 'checked' : ''}>
    <div class="rt-hd"><b>${TYPE_LABEL[st.type]}</b>${st.type === 'safe' ? '<span class="chip on">추천</span>' : ''}</div>
    <div class="rt-stats">
      <div><b>${st.minutes}분</b><span class="mu">소요 시간</span></div>
      <div><b>${st.km}km</b><span class="mu">거리</span></div>
      <div><b>${st.high}곳</b><span class="mu">3~4등급</span></div>
    </div>
    <div class="stat"><span class="nm">위험 점수</span><span class="bar"><i style="width:${Math.round(st.score / maxScore * 100)}%"></i></span><span class="v">${st.score}</span></div>
    <p class="mu">주의 지점 ${st.hazards.length}곳 · ${names}</p></label>`;
}

function render() {
  const F = res.fast, S = res.safe, max = Math.max(F.score, S.score, 1);
  $('#routeCards').innerHTML = card(F, max) + card(S, max);
  $('#goPreview').href = previewUrl({ origin: o, destination: d }, sel);
  $('#goPreview').textContent = `${TYPE_LABEL[sel]} 예습하기`;
  $('#goDrive').href = driveUrl({ origin: o, destination: d }, sel);
}

(async () => {
  res = await buildRoutes(o, d);
  $('#state-loading').classList.remove('on');
  $('#modeNote').textContent = res.mode === 'live'
    ? '카카오 길찾기 경로로 계산했어요 (실시간 경로)'
    : '데모 모드 — 샘플 경로예요. 카카오 키를 넣으면 실제 경로로 계산돼요';
  $('#modeNote').hidden = false;
  if (res.error) { $('#errNote').textContent = `경로 API 호출에 실패해 샘플로 보여드려요 (${res.error})`; $('#errNote').hidden = false; }
  $('#sampleNote').hidden = res.matched;

  const F = res.fast, S = res.safe, diffMin = S.minutes - F.minutes, diffHigh = F.high - S.high;
  $('#verdict').innerHTML = diffHigh > 0
    ? `안전 경로는 <b>${diffMin > 0 ? '+' + diffMin + '분' : '시간 차이 없이'}</b> ${diffMin > 0 ? '더 걸리지만 ' : ''}3~4등급 구간이 <b>${F.high}곳 → ${S.high}곳</b>으로 줄어요`
    : '빠른 경로도 충분히 안전해요. 그대로 가셔도 좋아요';
  $('#verdict').hidden = false;

  const worst = [...F.hazards].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount).slice(0, 3);
  $('#worstList').innerHTML = worst.map(h =>
    `<div class="card" data-href="${segUrl(h.seg.segmentId)}"><div><b class="roadName">${esc(h.seg.roadName)}</b>
      <p class="mu" style="white-space:normal">${adviceOf(h.seg).text}</p></div>${levelBadge(h.seg.riskLevel)}</div>`).join('');
  $('#worstBox').hidden = worst.length === 0;
  render();
})();

document.addEventListener('change', e => {
  if (e.target.name === 'routeType' && res) { sel = e.target.value; render(); }
});
$('#learnList').innerHTML = LEARN.slice(0, 2).map(learnCard).join('');
$('#tipList').innerHTML = TIPS.map(tipCard).join('');
