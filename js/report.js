/* report.js — 위험 구간 제보 (사용자가 만든 데이터, source: "user") */
const editId = qs().get('edit');
let editing = null;
function fillEdit() {
  editing = editId ? getReports().find(r => r.segmentId === editId) : null;
  if (!editing) return;
  $('#headerTitle').textContent = '제보 수정'; $('#submit').textContent = '수정 저장';
  $('#roadName').value = editing.roadName; $('#address').value = editing.address;
  $('#riskLevel').value = String(editing.riskLevel); $('#accidentCount').value = editing.accidentCount ?? '';
}
syncDown().then(fillEdit, fillEdit);                  // 로그인 중이면 서버의 내 제보를 먼저 받아 온다
$('#submit').addEventListener('click', async () => {
  const v = id => $('#' + id).value.trim();
  const err = m => { $('#errMsg').textContent = m; $('#state-err').classList.add('on'); $('#state-done').classList.remove('on'); };
  if (v('roadName').length < 2) return err('도로명을 2자 이상 입력해 주세요');
  if (v('address').length < 4) return err('주소를 입력해 주세요 (예: 서울특별시 강남구 논현동)');
  const raw = v('accidentCount');
  if (raw && !/^\d{1,3}$/.test(raw)) return err('사고 건수는 숫자만 입력해 주세요 (모르면 비워 두세요)');
  const payload = {
    roadName: v('roadName'), address: v('address'),
    accidentCount: raw ? +raw : null,            // 비우면 null → 화면에 '정보 없음 [미입력]'
    riskLevel: +v('riskLevel'), lat: null, lng: null
  };
  $('#submit').disabled = true;                      // 저장하는 동안 한 번 더 누르지 못하게
  try {
    if (editing) { if (!(await updateReport(editId, payload))) { $('#submit').disabled = false; return; } } else await addReport(payload);
  } catch (e) { $('#submit').disabled = false; return err(e.message); }
  $('#state-err').classList.remove('on'); $('#state-done').classList.add('on');
  $('#state-done .note').innerHTML = editing ? '제보를 수정했어요' : '제보가 저장됐어요. 목록의 <b>U</b> 아이콘으로 확인할 수 있어요';
  $('#submit').disabled = true;
});
