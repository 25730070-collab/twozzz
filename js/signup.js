/* signup.js — 가입 · 로그인 · 비밀번호 찾기 (v0.6: 이메일 + 비밀번호)
   · 가입     : 닉네임 + 이메일 → 이메일 인증번호로 이메일 주인 확인 → 비밀번호 정하기
   · 로그인   : 이메일 + 비밀번호 (틀린 이유는 알려 주지 않는다)
   · 비밀번호 찾기 : 이메일 인증번호 → 새 비밀번호 (다른 기기 로그인은 모두 풀린다)
   · 회원 서버(server/)가 없으면(화면만 올린 GitHub Pages 등): '실습 모드' — 비밀번호 없이 이 기기에만 저장하고 인증번호는 화면에 보여 준다. */
const nick = $('#nickname'), mail = $('#email'), code = $('#code'), pw = $('#password'), pw2 = $('#password2');
const sendBtn = $('#sendCode'), verifyBtn = $('#verify'), joinBtn = $('#join');
let live = null;                                       // 서버 정보({mail, db}) 또는 null(실습 모드)
let mode = ['login', 'reset'].includes(qs().get('mode')) ? qs().get('mode') : 'signup';
let sent = false, verified = false, verifyToken = null, left = 0, cool = 0, timer = null, busy = false;

const needCode = () => mode !== 'login';               // 로그인은 인증번호 없이 비밀번호로
const needPw = () => !!live;                           // 실습 모드에는 비밀번호가 없다
const nickOk = () => /^[가-힣A-Za-z0-9]{2,10}$/.test(nick.value.trim());
const mailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.value.trim());
/* 서버 규칙과 같은 기본 검사 (최종 판단은 서버): 8~64자 · 영문+숫자 */
const pwOk = v => v.length >= 8 && v.length <= 64 && /[A-Za-z]/.test(v) && /\d/.test(v);
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
  const nBad = mode === 'signup' && nick.value && !nickOk();
  $('#nickHint').textContent = nBad ? '닉네임은 한글·영문·숫자 2~10자예요' : '2~10자 (한글·영문·숫자)';
  $('#nickHint').style.color = nBad ? 'var(--r4)' : '';
  const pBad = mode !== 'login' && pw.value && !pwOk(pw.value), mBad = mode !== 'login' && pw2.value && pw2.value !== pw.value;
  $('#pwHint').textContent = pBad ? '8~64자, 영문과 숫자를 모두 넣어 주세요' : mBad ? '비밀번호가 서로 달라요' : mode === 'login' ? '' : '8자 이상, 영문과 숫자를 모두 넣어 주세요 (이메일·닉네임이 들어가면 안 돼요)';
  $('#pwHint').style.color = pBad || mBad ? 'var(--r4)' : '';
  sendBtn.disabled = busy || cool > 0 || verified || !((mode !== 'signup' || nickOk()) && mailOk());
  sendBtn.textContent = cool > 0 ? `재전송 ${cool}` : sent ? '재전송' : '인증번호 받기';
  verifyBtn.disabled = busy || !(sent && code.value.trim().length === 6 && !verified);
  if (mode === 'login') joinBtn.disabled = busy || !(mailOk() && pw.value);
  else joinBtn.disabled = busy || !(verified && mailOk() && (mode === 'reset' || nickOk()) && (!needPw() || (pwOk(pw.value) && pw.value === pw2.value)));
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
  const L = {
    signup: ['닉네임과 이메일,<br>비밀번호로 가입해요', live ? '이메일로 인증번호를 보내 이메일 주인인지 확인해요. 제보와 최근 검색은 내 계정에 저장돼서 다른 기기에서도 볼 수 있어요' : '가입하면 이 기기에서 이름으로 즐겨찾기를 관리해요'],
    login: ['이메일과 비밀번호로<br>로그인해요', '로그인하면 제보와 최근 검색을 어느 기기에서든 볼 수 있어요. 즐겨찾기는 이 기기에만 저장돼요'],
    reset: ['비밀번호를<br>새로 정해요', '가입한 이메일로 인증번호를 보내 드려요. 바꾸면 다른 기기의 로그인은 모두 풀려요']
  }[mode];
  $('#pageTitle').innerHTML = L[0]; $('#pageLead').textContent = L[1];
  $('#headerTitle').textContent = { signup: '회원가입', login: '로그인', reset: '비밀번호 찾기' }[mode];
  $('#nickField').hidden = mode !== 'signup';
  $('#codeField').hidden = !needCode();
  $('#sendCode').hidden = !needCode();
  $('#pwField').hidden = !needPw() && mode !== 'login'; $('#pw2Field').hidden = !needPw() || mode === 'login';
  if (mode === 'login') { $('#pwField').hidden = false; $('#pwLabel').innerHTML = '비밀번호<i aria-hidden="true">*</i>'; pw.autocomplete = 'current-password'; pw.placeholder = '비밀번호 입력'; }
  else $('#pwLabel').innerHTML = (mode === 'reset' ? '새 비밀번호' : '비밀번호') + '<i aria-hidden="true">*</i>';
  joinBtn.textContent = { signup: '가입하기', login: '로그인', reset: '비밀번호 바꾸기' }[mode];
  $('#doneMsg').textContent = { signup: '가입이 완료됐어요. 환영해요!', login: '로그인했어요. 다시 만나서 반가워요!', reset: '비밀번호를 바꿨어요. 이 기기는 로그인된 상태예요' }[mode];
  const note = $('#modeNote');
  if (!live) { note.hidden = false; note.textContent = '실습 모드예요. 회원 서버가 연결돼 있지 않아서 메일은 가지 않고, 비밀번호 없이 가입 정보는 이 기기에만 저장돼요.'; }
  else if (live.mail !== 'smtp' && mode !== 'login') { note.hidden = false; note.textContent = '개발 모드예요. 서버가 메일을 보내지 않고 서버 화면(터미널)에만 인증번호를 찍어요.'; }
  else note.hidden = true;
  $('#privacy').hidden = !live || mode === 'login';
  $('#forgotRow').hidden = !live || mode !== 'login';
  $('#swapRow').hidden = !live || mode === 'reset';
  $('#swapMode').textContent = mode === 'login' ? '처음이에요 · 가입하기' : '이미 가입했어요 · 로그인하기';
  $('#swapMode').href = mode === 'login' ? 'signup.html' : 'signup.html?mode=login';
  sync();
}

/* ---------- 동작 ---------- */
async function guard(fn) {                                // 요청 중에는 버튼을 잠가 중복 전송을 막는다
  busy = true; sync();
  try { await fn(); } finally { busy = false; sync(); }
}
const finish = () => { show('state-join-done'); joinBtn.disabled = true; document.querySelector('.cta-bar').hidden = true; [nick, mail, code, pw, pw2].forEach(e => { e.disabled = true; }); };

sendBtn.addEventListener('click', () => guard(async () => {
  const email = mail.value.trim();
  try {
    const r = live ? await Account.requestCode({ email, purpose: mode, nickname: mode === 'signup' ? nick.value.trim() : undefined }) : await demo.request();
    verified = false; verifyToken = null; code.value = ''; code.disabled = false; sent = true;
    startClock(r.expiresIn, r.resendIn);
    /* 가입된 이메일인지는 알려 주지 않는다 (남이 이 이메일로 가입했는지 알아내지 못하게) */
    $('#sentMsg').innerHTML = (live ? `<b></b> 로 인증번호를 보냈어요. 메일함을 확인해 주세요 (스팸함에 있을 수도 있어요). 메일이 오지 않으면 이메일 주소를 다시 확인해 주세요.` : `<b></b> 로 인증번호를 보냈다고 치고 진행해요. 연습 화면이라 메일은 가지 않아요.`)
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
    const r = live ? await Account.verifyCode({ email: mail.value.trim(), purpose: mode, code: code.value.trim() }) : await demo.verify(code.value.trim());
    clearInterval(timer); timer = null; $('#timer').textContent = '';
    verified = true; verifyToken = r.verifyToken;
    nick.disabled = mail.disabled = code.disabled = true;
    show('state-verified'); if (needPw()) pw.focus();
  } catch (e) {
    if (['expired', 'too_many', 'no_code'].includes(e.code)) { sent = false; code.value = ''; code.disabled = true; clearInterval(timer); $('#timer').textContent = ''; }
    fail(e.message);
  }
}));

joinBtn.addEventListener('click', () => guard(async () => {
  try {
    if (mode === 'login') await Account.saveSession(await Account.login(mail.value.trim(), pw.value));
    else if (mode === 'reset') await Account.saveSession(await Account.resetPassword(verifyToken, pw.value));
    else if (live) await Account.saveSession(await Account.signup(verifyToken, pw.value));
    else await demo.join();
    pw.value = pw2.value = '';                                        // 화면에 남지 않게
    finish();
  } catch (e) {
    if (['nickname_taken', 'email_taken', 'bad_token'].includes(e.code)) { reset(true); nick.disabled = mail.disabled = false; }   // 처음부터 다시 (닉네임을 바꿔야 할 수 있음)
    if (e.code === 'weak_password') pw.focus();
    if (e.code === 'bad_credentials') pw.value = '';
    fail(e.message);
  }
}));

[nick, mail, code].forEach(el => el.addEventListener('input', () => {
  if (el !== code && (sent || verified)) reset();
  sync();
}));
[pw, pw2].forEach(el => el.addEventListener('input', sync));
[mail, pw].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && mode === 'login' && !joinBtn.disabled) joinBtn.click(); }));
code.disabled = true;
sync();
Account.probe().then(info => { live = info; if (!live) mode = 'signup'; setupMode(); });      // 서버가 없으면 로그인할 계정도 없으니 가입(실습) 화면만
