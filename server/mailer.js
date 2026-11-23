/* mailer.js — 메일 보내기
   · SMTP_HOST 가 있으면 nodemailer 로 진짜 메일을 보낸다 (Gmail·네이버·Resend·SendGrid 등 SMTP 를 주는 곳 어디든)
   · 없으면 메일을 보내지 않고 서버 터미널에만 인증번호를 찍는다 (개발용) */
export async function createMailer(cfg = {}) {
  if (cfg.SMTP_HOST) {
    let nm;
    try { nm = await import('nodemailer'); } catch { throw new Error('nodemailer 패키지가 없어요. server 폴더에서 npm install 을 먼저 실행해 주세요'); }
    const port = Number(cfg.SMTP_PORT || 587);
    const tx = (nm.default || nm).createTransport({
      host: cfg.SMTP_HOST, port,
      secure: cfg.SMTP_SECURE ? cfg.SMTP_SECURE === '1' : port === 465,       // 465 는 처음부터 암호화, 587 은 STARTTLS
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD || '' } : undefined
    });
    const from = cfg.MAIL_FROM || cfg.SMTP_USER;
    if (!from) throw new Error('.env 에 MAIL_FROM(또는 SMTP_USER)이 없어요');
    return { kind: 'smtp', from, async send(m) { await tx.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html }); } };
  }
  return {
    kind: 'console',
    async send(m) {
      console.log(`\n[메일 미발송 · SMTP 미설정] 받는 사람: ${m.to}\n  제목: ${m.subject}\n  ${m.text.split('\n')[0]}\n`);
    }
  };
}
