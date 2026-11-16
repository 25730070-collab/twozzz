/* report.js — 위험 구간 제보 (사용자가 만든 데이터, source: "user") */
$('#submit').addEventListener('click', () => {
  const v = id => $('#' + id).value.trim();
  const err = m => { $('#errMsg').textContent = m; $('#state-err').classList.add('on'); $('#state-done').classList.remove('on'); };
  if (v('roadName').length < 2) return err('도로명을 2자 이상 입력해 주세요');
  if (v('address').length < 4) return err('주소를 입력해 주세요 (예: 서울특별시 강남구 논현동)');
  const raw = v('accidentCount');
  if (raw && !/^\d{1,3}$/.test(raw)) return err('사고 건수는 숫자만 입력해 주세요 (모르면 비워 두세요)');
  addReport({
    roadName: v('roadName'), address: v('address'),
    accidentCount: raw ? +raw : null,            // 비우면 null → 화면에 '정보 없음 [미입력]'
    riskLevel: +v('riskLevel'), lat: null, lng: null
  });
  $('#state-err').classList.remove('on'); $('#state-done').classList.add('on');
  $('#submit').disabled = true;
});
