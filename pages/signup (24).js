/* signup.js — 닉네임 · 이메일 · 인증번호 (이 3가지만 받음) */
const nick = $('#nickname'), mail = $('#email'), code = $('#code');
const sendBtn = $('#sendCode'), verifyBtn = $('#verify'), joinBtn = $('#join');
let sent = null, verified = false, left = 0, timer = null;

const nickOk = () => /^[가-힣A-Za-z0-9]{2,10}$/.test(nick.value.trim());
const mailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.value.trim());
const show = id => { $$('.state').forEach(s => s.classList.toggle('on', s.id === id)); };

function sync() {
  $('#nickHint').textContent = nick.value && !nickOk() ? '닉네임은 한글·영문·숫자 2~10자예요' : '2~10자 (한글·영문·숫자)';
  $('#nickHint').style.color = nick.value && !nickOk() ? 'var(--r4)' : '';
  sendBtn.disabled = !(nickOk() && mailOk());
  verifyBtn.disabled = !(sent && code.value.trim().length === 6 && !verified);
  joinBtn.disabled = !(verified && nickOk() && mailOk());
}

function tick() {
  left--; 
  $('#timer').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  if (left <= 0) { clearInterval(timer); sent = null; show('state-code-expired'); sync(); }
}

sendBtn.addEventListener('click', () => {
  sent = String(Math.floor(100000 + Math.random() * 900000));
  verified = false; code.value = ''; code.disabled = false; left = 180;
  clearInterval(timer); timer = setInterval(tick, 1000); $("#timer").textContent = "03:00";
  $('#sentTo').textContent = mail.value.trim();
  $('#demoCode').textContent = sent;            // 실습용: 실제 메일 발송 없이 화면에 표시
  sendBtn.textContent = '재전송';
  show('state-code-sent'); sync();
});

verifyBtn.addEventListener('click', () => {
  if (code.value.trim() === sent) {
    verified = true; clearInterval(timer);
    nick.disabled = mail.disabled = code.disabled = sendBtn.disabled = true;
    show('state-verified');
  } else show('state-code-error');
  sync();
});

joinBtn.addEventListener('click', () => {
  store.set(KEY.user, { nickname: nick.value.trim(), email: mail.value.trim() });
  show('state-join-done');
  joinBtn.disabled = true;
});

[nick, mail, code].forEach(el => el.addEventListener('input', () => {
  if (el !== code && sent) { sent = null; verified = false; clearInterval(timer); code.value = ''; code.disabled = true; sendBtn.textContent = '인증번호 받기'; show(''); }
  sync();
}));
code.disabled = true;
sync();
