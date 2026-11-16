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
  $('#dsStats').innerHTML = `<div><b>${by.J + by.A}</b><span class="mu">위험 구간</span></div><div><b>${by.J}</b><span class="mu">J</span></div><div><b>${by.A}</b><span class="mu">A</span></div><div><b>${u}</b><span class="mu">내 데이터</span></div>`;

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
       <p class="mu">자세한 결과는 F12 → Console의 [데이터 점검]에서 볼 수 있어요</p>`
    : '<p class="mu">점검 결과가 없어요</p>';
}

const show = id => $$('#state-confirm,#state-result,#state-error').forEach(s => s.classList.toggle('on', s.id === id));

document.addEventListener('click', e => {
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
  if (t.id === 'clearYes') { clearUserData(); show('state-result'); $('#resultMsg').textContent = '내 데이터를 모두 삭제했어요'; paint(); }
});

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    const r = importUser(obj.favorites_user || obj.reports_user || obj.recent_searches_user ? obj : (() => { throw new Error('즐겨찾기·최근 검색·제보 항목이 없는 파일이에요'); })());
    const added = Object.entries(r.added).map(([k, n]) => `${USER_DATASETS[k].label} ${n}건`).join(' · ');
    show('state-result');
    $('#resultMsg').textContent = `추가: ${added || '없음'}${r.skipped ? ` · 건너뜀 ${r.skipped}건 (형식이 다르거나 이미 있음)` : ''}`;
    paint();
  } catch (err) {
    show('state-error');
    $('#errorMsg').textContent = err instanceof SyntaxError ? 'JSON 파일이 아니에요. 내려받은 파일을 그대로 선택해 주세요' : err.message;
  }
});

Promise.all([fetch('../data/data_manifest.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), loadHazards()])
  .then(([m, r]) => { manifest = m; rows = r; $('#state-loading').classList.remove('on'); paint(); })
  .catch(err => { $('#state-loading').classList.remove('on'); $('main').insertAdjacentHTML('beforeend', emptyState({ title: '데이터 정보를 불러오지 못했어요', tips: [esc(err.message), '배포 주소에서 열었는지 확인해 주세요'], actions: [{ href: 'data.html', label: '다시 시도' }] })); });
