/* suggest.js — 장소 자동완성 (카카오 로컬 키워드 검색). 키가 없거나 검색이 실패하면 조용히 아무것도 보여 주지 않는다.
   후보를 고르면 이름을 입력창에 넣고, 그 장소의 좌표를 기억해 두었다가 경로를 만들 때 쓴다 (route-api.js 의 rememberPlace). */
function attachSuggest(input, { onPick } = {}) {
  const host = input.closest('.fld'); if (!host) return;
  const ul = document.createElement('ul'); ul.className = 'sug'; ul.id = 'sug-' + input.id; ul.setAttribute('role', 'listbox'); ul.hidden = true; host.appendChild(ul);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', ul.id); input.setAttribute('aria-expanded', 'false');
  let items = [], act = -1, seq = 0, timer = null, picking = false;

  const close = () => { ul.hidden = true; act = -1; input.setAttribute('aria-expanded', 'false'); };
  const paint = () => {
    ul.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === act}" class="${i === act ? 'on' : ''}"><b>${esc(it.name)}</b><span>${esc(it.addr)}</span></li>`).join('');
  };
  const open = () => { paint(); ul.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const pick = i => {
    const it = items[i]; if (!it) return;
    picking = true; input.value = it.name; rememberPlace(it.name, it.ll); close();
    input.dispatchEvent(new Event('input', { bubbles: true })); picking = false;     // 버튼 활성 상태 등을 갱신
    if (onPick) onPick(it);
  };

  input.addEventListener('input', () => {
    if (picking) return;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2 || q === '내 위치') return close();
    timer = setTimeout(async () => {
      const my = ++seq; let r = [];
      try { r = await searchPlaces(q); } catch (e) { console.warn('장소 검색 실패:', e.message); }
      if (my !== seq) return;                                                         // 더 새로운 입력이 있으면 이전 결과는 버린다
      items = r; act = -1;
      if (items.length) open(); else close();
    }, 250);
  });
  input.addEventListener('keydown', e => {
    if (ul.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(act); }   // 후보를 고른 Enter는 '경로 비교 시작'으로 넘어가지 않게
    else if (e.key === 'Escape') { e.preventDefault(); close(); }          // 목록만 닫는다 (type=search 의 Esc 기본 동작은 입력 내용을 지워 버리므로 막는다)
  }, true);
  ul.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (!li) return; e.preventDefault(); pick(Number(li.dataset.i)); });   // 입력창이 포커스를 잃기 전에 처리
  input.addEventListener('blur', () => setTimeout(close, 150));
}
