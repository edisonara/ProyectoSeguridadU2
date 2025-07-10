const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL
} = process.env;

if (!SMTP_HOST) {
  console.warn('⚠️  SMTP_HOST no definido en .env, el envío de correos fallará');
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT || 587,
  secure: Number(SMTP_PORT) === 465, // true para 465, false para otros
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

async function sendEmail(to, subject, html) {
  if (!SMTP_HOST) {
    console.error('No se puede enviar email: SMTP no configurado');
    return;
  }
  const info = await transporter.sendMail({
    from: FROM_EMAIL || SMTP_USER,
    to,
    subject,
    html
  });
  return info;
}

module.exports = { sendEmail };
