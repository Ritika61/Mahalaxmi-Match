// src/controllers/contact.controller.js
const nodemailer = require('nodemailer');
const { dbp } = require('../db');
const { sendLeadEmail } = require('../services/mail.service');
const { inquirySchema } = require('../validation/schemas');
const { cleanHtml, cleanText } = require('../utils/sanitize');

function initWizard(session) {
  session.wizard ??= { profile: null, interest: null, extra: {}, person: {} };
}

/* ────────────────────────────────────────────────────────────
   Company + Email
──────────────────────────────────────────────────────────── */
const COMPANY = {
  name: 'Jay Mahalaxmi Ind. Pvt. Ltd',
  phone: '+977 9857021308',
  address: 'Lumbini Province, Butwal-16, Rupandehi, Nepal'
};

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

async function sendThankYouEmail(toEmail, name) {
  const transport = getTransport();
  if (!transport) return;
  const from = process.env.SMTP_FROM || `"${COMPANY.name}" <jaymahalaxmi2316@gmail.com>`;
  const subject = `Thanks for contacting ${COMPANY.name}`;
  const first = (name || '').trim().split(' ')[0] || 'there';
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;color:#111">
      <p>Hi ${first},</p>
      <p>Thanks for reaching out to <strong>${COMPANY.name}</strong>. We’ve received your message and a team member will get back to you soon.</p>
      <p style="margin:0">Regards,<br><strong>${COMPANY.name}</strong></p>
      <p style="color:#555;margin-top:8px">${COMPANY.address}  </p>
      p<p style="color:#555;margin-top:0px">Phone: ${COMPANY.phone}</p>
    </div>
  `;
  await transport.sendMail({ from, to: toEmail, subject, html });
}

/* --- Step 1: Profile --- */
exports.getProfile = (req, res) => {
  initWizard(req.session);
  res.render('contact/step-profile', { title: 'Contact — Profile', data: req.session.wizard });
};
exports.postProfile = (req, res) => {
  initWizard(req.session);
  req.session.wizard.profile = req.body.profile;
  res.redirect('/contact/step/interest');
};

/* --- Step 2: Interest --- */
exports.getInterest = (req, res) => {
  initWizard(req.session);
  res.render('contact/step-interest', { title: 'Contact — Interest', data: req.session.wizard });
};
exports.postInterest = (req, res) => {
  initWizard(req.session);
  req.session.wizard.interest = req.body.interest;
  res.redirect('/contact/step/extra');
};

/* --- Step 3: Extra details --- */
exports.getExtra = (req, res) => {
  initWizard(req.session);
  res.render('contact/step-extra', { title: 'Contact — Details', data: req.session.wizard });
};
exports.postExtra = (req, res) => {
  initWizard(req.session);
  req.session.wizard.extra = {
    product_hint: req.body.product_hint || null,
    est_annual_volume: req.body.est_annual_volume || null,
    business_website: req.body.business_website || null,
    // If checkboxes were used, supplier_tags comes as an array; join it.
    supplier_tags: Array.isArray(req.body.supplier_tags)
      ? req.body.supplier_tags.join(', ')
      : (req.body.supplier_tags || '')
  };
  res.redirect('/contact/step/message');
};

/* --- Step 4: Message + submit --- */
exports.getMessage = (req, res) => {
  initWizard(req.session);
  res.render('contact/step-message', { title: 'Contact — Your message', data: req.session.wizard });
};

exports.submit = async (req, res) => {
  initWizard(req.session);

  const payload = {
    profile: req.session.wizard?.profile,
    interest: req.session.wizard?.interest,
    product_hint: req.session.wizard?.extra?.product_hint || null,
    est_annual_volume: req.session.wizard?.extra?.est_annual_volume || null,
    business_website: req.session.wizard?.extra?.business_website || null,
    supplier_tags: req.session.wizard?.extra?.supplier_tags || null,
    first_name: req.body.first_name,
    last_name:  req.body.last_name,
    email:      req.body.email,
    phone:      req.body.phone,
    country:    req.body.country,
    message:    req.body.message,
    consent:    !!req.body.consent,
    // optional company field (won't hurt if schema strips it)
    company:    req.body.company || null,
  };

  const { error, value } = inquirySchema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) {
    const msg = error.details.map(d => d.message).join('<br>');
    return res
      .status(400)
      .render('contact/step-message', { title: 'Contact — Your message', data: req.session.wizard, error: msg });
  }

  // Sanitize
  value.first_name   = cleanText(value.first_name);
  value.last_name    = cleanText(value.last_name);
  value.email        = cleanText(value.email);
  value.phone        = cleanText(value.phone || '');
  value.country      = cleanText(value.country);
  value.message      = cleanHtml(value.message || '');
  value.supplier_tags= cleanText(value.supplier_tags || '');
  value.product_hint = cleanText(value.product_hint || '');
  const fullName = [value.first_name, value.last_name].filter(Boolean).join(' ').trim() || value.email;
  const companyClean = cleanText(payload.company || '');

  const ip = (req.headers['cf-connecting-ip'] || req.ip || '').toString().slice(0, 64);
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 255);

  // Save to your SCHEMA table: contacts (NOT inquiries)
  // contacts: id, name, email, country, Company, message, created_at
  const [r] = await dbp.query(
    'INSERT INTO contacts (name, email, country, `Company`, message) VALUES (?, ?, ?, ?, ?)',
    [fullName, value.email, value.country, companyClean || null, value.message]
  );

  // Internal notification (best-effort)
  try {
    await sendLeadEmail(r.insertId, {
      // pass along useful context
      name: fullName,
      email: value.email,
      phone: value.phone || null,
      country: value.country,
      company: companyClean || null,
      message: value.message,
      profile: value.profile || null,
      interest: value.interest || null,
      product_hint: value.product_hint || null,
      est_annual_volume: value.est_annual_volume || null,
      business_website: value.business_website || null,
      supplier_tags: value.supplier_tags || null,
      consent: !!value.consent
    });
  } catch (e) {
    // don't block user flow if internal email fails
    console.error('sendLeadEmail failed:', e);
  }

  // Thank-you email to client (best-effort)
  sendThankYouEmail(value.email, fullName).catch(err => console.error('thank-you email error:', err));

  // Audit
  await dbp.query(
    `INSERT INTO audit_logs(actor_type, action, resource, meta, ip, ua)
     VALUES('anon','contact.create','contacts',JSON_OBJECT('id',?), ?, ?)`,
    [r.insertId, ip, ua]
  );

  // Clear wizard and show TY page
  req.session.wizard = null;
  res.redirect('/contact/thank-you');
};

exports.thankYou = (_req, res) =>
  res.render('contact/thank-you', { title: 'Thank you!' });
