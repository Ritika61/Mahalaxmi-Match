// src/routes/contact.js
const express = require('express');
const router = express.Router();
const csrf = require('csurf');
const Joi = require('joi');
const nodemailer = require('nodemailer');
const { pool } = require('../db');

/* CSRF (cookie-based) */
const CSRF_COOKIE = '_csrf';
const csrfProtection = csrf({ cookie: { httpOnly: true, sameSite: 'lax', secure: false } });
const setCsrf = (req, res, next) => { try { res.locals.csrfToken = req.csrfToken(); } catch {} next(); };

/* Company (for email footer) */
const COMPANY = {
  name: 'Jay Mahalaxmi Ind. Pvt. Ltd',
  email: 'contact@mahalaxmi.com',
  phone: '+977 9857021308',
  address: 'Lumbini Province, Butwal-16, Rupandehi, Nepal',
  mapQuery: 'Lumbini Province, Butwal-16, Rupandehi, Nepal'
};

/* Validate against your contacts schema */
const schema = Joi.object({
  name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email({ tlds: false }).required(),
  country: Joi.string().max(100).required(),
  Company: Joi.string().max(150).allow('', null),   // DB column is capital C
  message: Joi.string().min(10).max(4000).required(),
  companyFaxNumber: Joi.string().allow('', null)     // honeypot
});

/* Email (optional) */
function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
}

async function sendThankYouEmail(toEmail, fullName) {
  const transport = getTransport();
  if (!transport) return;

  const BRAND_NAME   = COMPANY.name || 'Jay Mahalaxmi Ind. Pvt. Ltd';
  const BRAND_COLOR  = '#3b82f6';
  const FROM_EMAIL   = process.env.SMTP_FROM  || `"${BRAND_NAME}" <no-reply@mahalaxmi.local>`;
  const REPLY_TO     = process.env.REPLY_TO   || COMPANY.email || 'info@example.com';
  const WEBSITE_URL  = process.env.SITE_URL   || '#';
  const firstName    = (fullName || '').trim().split(/\s+/)[0] || 'there';

  const subject = `Thank you for contacting ${BRAND_NAME} — how can we help?`;
  const text = [
    `Thank you for contacting ${BRAND_NAME}!`,
    ``,
    `Hi ${firstName},`,
    `We've received your message and will get back to you shortly.`,
    ``,
    `How can we help? You can reply to this email and share any extra details.`,
    ``,
    `— The ${BRAND_NAME} Team`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb"><tr><td align="center" style="padding:32px 12px">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <tr><td style="padding:16px 24px;background:#0b1220;color:#e5e7eb;font:600 14px system-ui,-apple-system,Segoe UI,Roboto,Arial">${BRAND_NAME}</td></tr>
    <tr><td style="padding:28px 24px;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#111">
      <h1 style="margin:0 0 12px 0;font:800 24px system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#111">
        Thank you for contacting <a href="${WEBSITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;border-bottom:2px solid ${BRAND_COLOR}">${BRAND_NAME}</a>!
      </h1>
      <p style="margin:0 0 12px 0">Hi <strong>${firstName}</strong>,</p>
      <p style="margin:0 0 12px 0">We’ve received your message and will get back to you shortly.</p>
      <p style="margin:0 0 18px 0"><strong>How can we help?</strong> You can reply to this email and share any extra details.</p>
      <p style="margin:18px 0 0 0;color:#374151">— The ${BRAND_NAME} Team<br><span style="color:#6b7280">${COMPANY.address}  <br>
      • ${COMPANY.phone}</span></p>
    </td></tr>
    <tr><td style="padding:18px 24px 24px 24px;color:#6b7280;font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial">
      You’re receiving this because you contacted ${BRAND_NAME}.
    </td></tr>
  </table>
  <div style="font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#9ca3af;margin-top:12px">© ${new Date().getFullYear()} ${BRAND_NAME}</div>
  </td></tr></table></body></html>`;

  await transport.sendMail({ from: FROM_EMAIL, to: toEmail, replyTo: REPLY_TO, subject, text, html });
}

/* GET form */
function renderForm(req, res, extraError = null) {
  res.render('contact', { title: 'Contact Us', company: COMPANY, data: {}, success: null, error: extraError, csrfToken: res.locals.csrfToken });
}
router.get('/', csrfProtection, setCsrf, (req, res) => {
  const csrfMsg = req.query.err === 'csrf' ? 'Your form session expired. Please try again.' : null;
  renderForm(req, res, csrfMsg);
});
router.get('/step/profile', csrfProtection, setCsrf, (req, res) => renderForm(req, res));

/* POST submit (supports legacy path too) */
const handleContactPost = async (req, res, next) => {
  try {
    // honey pot
    if (req.body.companyFaxNumber) {
      return res.render('contact', { title:'Contact Us', company:COMPANY, data:{}, success:'Thanks! Your message was received.', error:null, csrfToken: res.locals.csrfToken });
    }

    // 🔧 normalize: accept lower-case 'company' from the form → DB column 'Company'
    const body = { ...req.body, Company: req.body.Company || req.body.company || null };

    const { value, error } = schema.validate(body, { abortEarly:false, stripUnknown:true });
    if (error) {
      const msg = error.details.map(d => d.message).join('<br>');
      return res.status(400).render('contact', { title:'Contact Us', company:COMPANY, data:req.body, success:null, error:msg, csrfToken: res.locals.csrfToken });
    }

    await pool.query(
      `INSERT INTO contacts (name, email, country, \`Company\`, message)
       VALUES (?, ?, ?, ?, ?)`,
      [value.name, value.email, value.country, value.Company || null, value.message]
    );

    // fire-and-forget email
    sendThankYouEmail(value.email, value.name).catch(err => console.error('email error:', err));

    return res.render('contact', {
      title: 'Contact Us',
      company: COMPANY,
      data: {},
      success: 'Thanks! Your message was received. We will get back to you shortly.',
      error: null,
      csrfToken: res.locals.csrfToken
    });
  } catch (e) { next(e); }
};
router.post(['/', '/step/profile'], csrfProtection, setCsrf, handleContactPost);

/* CSRF error -> refresh token */
router.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    try { res.clearCookie(CSRF_COOKIE, { path: '/' }); } catch {}
    return res.redirect('/contact?err=csrf');
  }
  next(err);
});

module.exports = router;
