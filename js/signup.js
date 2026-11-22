/* signup.js — 가입 · 로그인 (닉네임 · 이메일 · 이메일 인증번호, 비밀번호 없음)
   · 회원 서버(server/)가 있으면: 진짜 이메일로 인증번호를 보내고 DB 에 회원을 저장한다. 가입한 이메일로 로그인도 된다.
   · 서버가 없으면(화면만 올린 GitHub Pages 등): '실습 모드' — 이 기기에만 저장하고 인증번호는 화면에 보여 준다. */
const nick = $('#nickname'), mail = $('#email'), code = $('#code');
const sendBtn = $('#sendCode'), verifyBtn = $('#verify'), joinBtn = $('#join');
let live = null;                                       // 서버 정보({mail, db}) 또는 null(실습 모드)
let loginMode = qs().get('mode') === 'login';
let sent = false, verified = false, verifyToken = null, left = 0, cool = 0, timer = null, busy = false;

const nickOk = () => /^[가-힣A-Za-z0-9]{2,10}$/.test(nick.value.trim());
const mailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.value.trim());
const show = id => { $$('.state').forEach(s => s.classList.toggle('on', s.id === id)); };
const fail = msg => { $('#errMsg').textContent = msg; show('state-code-error'); };
const mmss = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/* ---------- 실습 모드 : 서버 없이 이 기기에서만 ---------- */
let demoCode = null;
const demo = {
  async request() { demoCode = String(Math.floor(100000 + Math.random() * 900000)); return { expiresIn: 180, resendIn: 0, devCode: demoCode, demo: true }; },
  async verify(c) { if (c !== demoCode) throw Object.assign(new Error('인증번호가 맞지 않아요. 다시 확인해 주세요'), { code: 'wrong_code' }); return { verifyToken: 'demo' }; },
  async join() { store.set(KEY.user, { nickname: nick.value.trim(), email: mail.value.trim() }); }
};

/* ---------- 화면 상태 ---------- */
function sync() {
  const nBad = !loginMode && nick.value && !nickOk();
  $('#nickHint').textContent = nBad ? '닉네임은 한글·영문·숫자 2~10자예요' : '2~10자 (한글·영문·숫자)';
  $('#nickHint').style.color = nBad ? 'var(--r4)' : '';
  sendBtn.disabled = busy || cool > 0 || verified || !((loginMode || nickOk()) && mailOk());
  sendBtn.textContent = cool > 0 ? `재전송 ${cool}` : sent ? '재전송' : '인증번호 받기';
  verifyBtn.disabled = busy || !(sent && code.value.trim().length === 6 && !verified);
  joinBtn.disabled = busy || !(verified && !loginMode && nickOk() && mailOk());
}

function startClock(expiresIn, resendIn) {
  left = expiresIn; cool = resendIn; clearInterval(timer);
  $('#timer').textContent = mmss(left);
  timer = setInterval(() => {
    left--; if (cool > 0) cool--;
    $('#timer').textContent = mmss(Math.max(left, 0));
    if (left <= 0) { clearInterval(timer); sent = false; cool = 0; code.value = ''; fail('입력 시간이 지났어요. 인증번호를 다시 받아 주세요'); }
    sync();
  }, 1000);
}

function reset(keepNote) {                                // 입력을 바꾸면 인증을 처음부터
  sent = false; verified = false; verifyToken = null; clearInterval(timer); cool = 0;
  code.value = ''; code.disabled = true; $('#timer').textContent = '';
  if (!keepNote) show('');
}

function setupMode() {
  const lead = loginMode ? ['가입한 이메일로<br>로그인해요', '이메일로 인증번호를 보내 드려요. 비밀번호는 필요 없어요']
    : ['닉네임과 이메일만<br>있으면 돼요', live ? '이메일로 인증번호를 보내 드려요. 가입하면 이 기기에서 이름으로 즐겨찾기를 관리해요' : '가입하면 이 기기에서 이름으로 즐겨찾기를 관리해요'];
  $('#pageTitle').innerHTML = lead[0]; $('#pageLead').textContent = lead[1];
  $('#headerTitle').textContent = loginMode ? '로그인' : '회원가입';
  $('#nickField').hidden = loginMode;
  document.querySelector('.cta-bar').hidden = loginMode;
  document.querySelector('.app').classList.toggle('has-cta', !loginMode);
  $('#doneMsg').textContent = loginMode ? '로그인했어요. 다시 만나서 반가워요!' : '가입이 완료됐어요. 환영해요!';
  const note = $('#modeNote');
  if (!live) { note.hidden = false; note.textContent = '실습 모드예요. 회원 서버가 연결돼 있지 않아서 메일은 가지 않고, 가입 정보는 이 기기에만 저장돼요.'; }
  else if (live.mail !== 'smtp') { note.hidden = false; note.textContent = '개발 모드예요. 서버가 메일을 보내지 않고 서버 화면(터미널)에만 인증번호를 찍어요.'; }
  else note.hidden = true;
  $('#privacy').hidden = !live;
  $('#swapRow').hidden = !live;
  $('#swapMode').textContent = loginMode ? '처음이에요 · 가입하기' : '이미 가입했어요 · 로그인하기';
  $('#swapMode').href = loginMode ? 'signup.html' : 'signup.html?mode=login';
  sync();
}

/* ---------- 동작 ---------- */
async function guard(fn) {                                // 요청 중에는 버튼을 잠가 중복 전송을 막는다
  busy = true; sync();
  try { await fn(); } finally { busy = false; sync(); }
}

sendBtn.addEventListener('click', () => guard(async () => {
  const email = mail.value.trim(), purpose = loginMode ? 'login' : 'signup';
  try {
    const r = live ? await Account.requestCode({ email, purpose, nickname: loginMode ? undefined : nick.value.trim() }) : await demo.request();
    verified = false; verifyToken = null; code.value = ''; code.disabled = false; sent = true;
    startClock(r.expiresIn, r.resendIn);
    $('#sentMsg').innerHTML = (live ? `<b></b> 로 인증번호를 보냈어요. 메일함을 확인해 주세요 (스팸함에 있을 수도 있어요).` : `<b></b> 로 인증번호를 보냈다고 치고 진행해요. 연습 화면이라 메일은 가지 않아요.`)
      + (r.devCode ? `<br>${r.demo ? '' : '개발 모드: '}인증번호 <b class="devcode"></b> 를 입력해 주세요` : '');
    $('#sentMsg').querySelector('b').textContent = email;
    const dc = $('#sentMsg .devcode'); if (dc) dc.textContent = r.devCode;
    show('state-code-sent'); code.focus();
  } catch (e) {
    if (e.code === 'cooldown' && e.data && e.data.retryAfter) { cool = e.data.retryAfter; if (!timer) timer = setInterval(() => { if (cool > 0) cool--; else { clearInterval(timer); timer = null; } sync(); }, 1000); }
    fail(e.message);
  }
}));

verifyBtn.addEventListener('click', () => guard(async () => {
  try {
    const r = live ? await Account.verifyCode({ email: mail.value.trim(), purpose: loginMode ? 'login' : 'signup', code: code.value.trim() }) : await demo.verify(code.value.trim());
    clearInterval(timer); timer = null; $('#timer').textContent = '';
    if (loginMode) { Account.saveSession(r); show('state-join-done'); document.querySelector('.cta-bar').hidden = true; mail.disabled = code.disabled = true; return; }
    verified = true; verifyToken = r.verifyToken;
    nick.disabled = mail.disabled = code.disabled = true;
    show('state-verified');
  } catch (e) {
    if (['expired', 'too_many', 'no_code'].includes(e.code)) { sent = false; code.value = ''; code.disabled = true; clearInterval(timer); $('#timer').textContent = ''; }
    fail(e.message);
  }
}));

joinBtn.addEventListener('click', () => guard(async () => {
  try {
    if (live) Account.saveSession(await Account.signup(verifyToken)); else await demo.join();
    show('state-join-done'); joinBtn.disabled = true;
  } catch (e) {
    if (['nickname_taken', 'email_taken', 'bad_token'].includes(e.code)) { reset(true); nick.disabled = mail.disabled = false; }   // 처음부터 다시 (닉네임을 바꿔야 할 수 있음)
    fail(e.message);
  }
}));

[nick, mail, code].forEach(el => el.addEventListener('input', () => {
  if (el !== code && (sent || verified)) reset();
  sync();
}));
code.disabled = true;
sync();
Account.probe().then(info => { live = info; if (!live) loginMode = false; setupMode(); });      // 서버가 없으면 로그인할 계정도 없으니 가입(실습) 화면만
