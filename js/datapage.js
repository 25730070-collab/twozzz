/* datapage.js — 데이터 관리: 파일 목록·건수·구분표·점검 결과, JSON 내려받기·가져오기·삭제 */
let manifest = null, rows = [];
const FLAG_KEY = { J: 'static', A: 'api', U: 'user' };
const tag = f => `<span class="src ${f.toLowerCase()}" aria-label="${f}">${f}</span>`;

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/* 데이터셋 id → 현재 내용 */
const contentOf = id => {
  if (id === 'segments_static') return rows.filter(r => r.source === 'static');
  if (id === 'segments_api') return rows.filter(r => r.source === 'api');
  return store.get(USER_DATASETS[id].key, []);
};

function paint() {
  const by = { J: contentOf('segments_static').length, A: contentOf('segments_api').length };
  const u = ['reports_user', 'favorites_user', 'recent_searches_user'].reduce((n, id) => n + contentOf(id).length, 0);
  $('#dsStats').innerHTML = `<div><b>${by.J + by.A}</b><span class="mu">위험 구간</span></div><div><b>${by.J}</b><span class="mu">J 구간</span></div><div><b>${by.A}</b><span class="mu">A 구간</span></div><div><b>${u}</b><span class="mu">내 데이터</span></div>`;

  $('#dsPnt').textContent = DATA_STATUS.pnt === 'ok' ? `사고 유형·인명 피해를 연결한 구간 ${DATA_STATUS.pntMatched}곳 (구간 좌표 150m 안의 국토교통부 사고다발지점)` : DATA_STATUS.pnt === 'fail' ? '사고 유형·인명 피해 파일(pntfr_points.json)을 불러오지 못했어요' : '';

  $('#dsList').innerHTML = manifest.datasets.map(d => {
    const n = contentOf(d.id).length;
    const warn = d.expectedCount != null && n !== d.expectedCount ? `<p class="note err">예상 ${d.expectedCount}건과 달라요</p>` : '';
    return `<div class="card plain"><div><b>${d.label}</b>
      <p class="mu" style="white-space:normal">${d.file} · ${n}건</p>
      <p class="mu" style="white-space:normal">${d.origin}</p>
      <p class="mu" style="white-space:normal">저장 위치: ${d.storage}</p>${warn}</div>
      <span class="tags">${tag(d.flag)}</span><button class="chip dl" data-id="${d.id}" data-file="${d.file.split('/').pop()}">내려받기</button></div>`;
  }).join('');

  $('#flagList').innerHTML = Object.entries(manifest.flags).map(([k, f]) =>
    `<div class="card plain"><div><b>${f.name}</b><p class="mu" style="white-space:normal">${f.desc}</p></div><span class="tags">${tag(k)}</span></div>`).join('');
  $('#fieldList').innerHTML = manifest.fields.map(f =>
    `<div class="card plain"><div><b>${f.name}</b><p class="mu" style="white-space:normal">${f.label}</p></div><span class="tags"><span class="type-tag ft-${f.class === 'managed' ? 'api' : f.class}">${manifest.classes[f.class]}</span></span></div>`).join('');

  const c = window.LAST_CHECK;
  $('#checkBox').innerHTML = c
    ? `<p><b>${c.warn.length ? `경고 ${c.warn.length}건` : '이상 없음'}</b></p>
       <p class="mu">총 ${c.total}건 · J ${c.by.static || 0} / A ${c.by.api || 0} / U ${c.by.user || 0}</p>
       <p class="mu">빈 값(null): ${Object.keys(c.nulls).length ? Object.entries(c.nulls).map(([k, v]) => `${k} ${v}건`).join(' · ') : '없음'}</p>
       ${c.warn.slice(0, 5).map(w => `<p class="note err">${esc(w)}</p>`).join('')}
`
    : '<p class="mu">점검 결과가 없어요</p>';
}

const show = id => $$('#state-confirm,#state-result,#state-error').forEach(s => s.classList.toggle('on', s.id === id));

document.addEventListener('click', async e => {
  const t = e.target;
  const dl = t.closest('.dl');
  if (dl) { download(dl.dataset.file, contentOf(dl.dataset.id)); return; }
  if (t.id === 'dlAll') {
    download('safedrive_data_all.json', { manifest: { project: manifest.project, exportedAt: new Date().toISOString(), flags: manifest.flags },
      ...Object.fromEntries(manifest.datasets.map(d => [d.id, contentOf(d.id)])) });
    return;
  }
  if (t.id === 'clearBtn') show('state-confirm');
  if (t.id === 'clearNo') show('');
  if (t.id === 'clearYes') { await clearUserData(); show('state-result'); $('#resultMsg').textContent = '내 데이터를 모두 삭제했어요'; paint(); }
});

/* 파일·붙여넣기 공통 가져오기: JSON 검사 → importUser(형식이 맞는 새 항목만) → 로그인 중이면 서버로 올림 */
async function doImport(text) {
  try {
    const obj = JSON.parse(text);
    if (!(obj.favorites_user || obj.reports_user || obj.recent_searches_user)) throw new Error('즐겨찾기·최근 검색·제보 항목이 없는 파일이에요');
    const r = importUser(obj);
    if (typeof syncUp === 'function') await syncUp();           // 서버 계정이면 가져온 제보·검색도 DB에 올린다 (즐겨찾기는 이 기기에만)
    const added = Object.entries(r.added).map(([k, n]) => `${USER_DATASETS[k].label} ${n}건`).join(' · ');
    show('state-result');
    $('#resultMsg').textContent = `추가: ${added || '없음'}${r.skipped ? ` · 건너뜀 ${r.skipped}건 (형식이 다르거나 이미 있음)` : ''}`;
    paint();
  } catch (err) {
    show('state-error');
    $('#errorMsg').textContent = err instanceof SyntaxError ? 'JSON 형식이 아니에요. 내려받은 내용을 그대로 넣어 주세요' : err.message;
  }
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) doImport(await f.text());
});
$('#copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(Object.fromEntries(['favorites_user', 'reports_user', 'recent_searches_user'].map(id => [id, contentOf(id)])), null, 2);
  try { await navigator.clipboard.writeText(text); show('state-result'); $('#resultMsg').textContent = '내 데이터를 복사했어요. 다른 기기에서 붙여넣기로 가져오세요'; }
  catch { $('#pasteBox').value = text; $('#pasteBox').select(); show('state-result'); $('#resultMsg').textContent = '복사 권한이 없어서 아래 칸에 채웠어요. 직접 복사해 주세요'; }
});
$('#pasteBtn').addEventListener('click', () => { const v = $('#pasteBox').value.trim(); if (v) doImport(v); else { show('state-error'); $('#errorMsg').textContent = '붙여넣을 내용이 없어요'; } });

Promise.all([fetch('../data/data_manifest.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), loadHazards()])
  .then(([m, r]) => { manifest = m; rows = r; $('#state-loading').classList.remove('on'); paint(); })
  .catch(err => { $('#state-loading').classList.remove('on'); $('main').insertAdjacentHTML('beforeend', emptyState({ title: '데이터 정보를 불러오지 못했어요', tips: [esc(err.message), '배포 주소에서 열었는지 확인해 주세요'], actions: [{ href: 'data.html', label: '다시 시도' }] })); });
