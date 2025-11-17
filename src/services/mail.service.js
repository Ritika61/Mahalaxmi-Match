// src/services/mail.service.js
const nodemailer = require('nodemailer');
const dns = require('dns');

// Prefer IPv4 first (Node 18+). Falls back silently if not supported.
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

// helper: strict boolean
const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const isProd      = process.env.NODE_ENV === 'production';
const SMTP_HOST   = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);     // ⬅️ default to 587
const SMTP_SECURE = bool(process.env.SMTP_SECURE ?? false);   // ⬅️ false for 587
const SMTP_USER   = process.env.SMTP_USER;
const SMTP_PASS   = process.env.SMTP_PASS;

const FROM_EMAIL  = process.env.FROM_EMAIL || (SMTP_USER ? `"Jay Mahalaxmi" <${SMTP_USER}>` : undefined);
const REPLY_TO    = process.env.REPLY_TO || FROM_EMAIL;
const TO_SALES    = process.env.TO_SALES || SMTP_USER;

// Force IPv4 lookup to avoid EDNS/IPv6 hiccups
const lookupIPv4 = (hostname, opts, cb) => dns.lookup(hostname, { family: 4 }, cb);

// Primary transporter (587 / STARTTLS)
function mkTransport(host) {
  return nodemailer.createTransport({
    host,
    port: SMTP_PORT,
    secure: SMTP_SECURE,     // false for 587, true if you explicitly switch to 465
    requireTLS: !SMTP_SECURE,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    // Fail fast instead of hanging
    connectionTimeout: 10_000,
    greetingTimeout:   8_000,
    socketTimeout:     20_000,
    // Force IPv4
    lookup: lookupIPv4,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    tls: isProd ? {} : { rejectUnauthorized: false }
  });
}

let transporter = mkTransport(SMTP_HOST);
let transporterFallback = mkTransport('smtp.googlemail.com'); // Google’s alias

async function verifyTransport() {
  try {
    await transporter.verify();
    console.log(`[MAIL] SMTP verified: ${SMTP_HOST}:${SMTP_PORT} ${SMTP_SECURE ? '(secure)' : '(starttls)'}`);
  } catch (err) {
    console.error('[MAIL] SMTP verify failed:', err?.message || err);
    try {
      await transporterFallback.verify();
      console.log('[MAIL] SMTP fallback verified: smtp.googlemail.com');
      // swap in fallback for future sends
      transporter = transporterFallback;
    } catch (err2) {
      console.error('[MAIL] Fallback verify failed:', err2?.message || err2);
    }
  }
}

async function sendMail({ to, subject, html, text, from = FROM_EMAIL, replyTo = REPLY_TO, bcc }) {
  if (!to) throw new Error('sendMail: "to" is required');
  if (!from) throw new Error('sendMail: "from" is not configured');

  const plain = text || html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Try primary, then fallback if DNS/connect errors
  const attempt = async (tx) => tx.sendMail({ to, subject, html, text: plain, from, replyTo, bcc });

  try {
    const info = await attempt(transporter);
    if (!isProd) console.log('[MAIL] Sent:', { messageId: info.messageId, to, subject });
    return info;
  } catch (e) {
    const msg = e?.message || String(e);
    const transient = /EAI_AGAIN|ETIMEOUT|EDNS|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg);
    if (transient) {
      console.warn('[MAIL] Primary send failed (transient). Retrying via fallback…', msg);
      try {
        const info2 = await attempt(transporterFallback);
        // If fallback worked, flip to it for the session
        transporter = transporterFallback;
        return info2;
      } catch (e2) {
        console.error('[MAIL] Fallback send failed:', e2?.message || e2);
      }
    } else {
      console.error('[MAIL] sendMail failed (non-transient):', msg);
    }
    if (!isProd) console.warn('[MAIL][DEV] Delivery failed, continuing (dev).');
    return null;
  }
}

// Public helpers
async function sendOtpEmail(to, code, minutes = 5) {
  // No BCC on OTP → faster & fewer spam heuristics
  const subject = 'Your Admin OTP Code';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">
      <p>Here is your one-time code:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:3px">${String(code).padStart(6, '0')}</p>
      <p>This code will expire in ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
    </div>
  `;
  return sendMail({ to, subject, html });
}

async function sendLeadEmail(id, data) {
  const to = TO_SALES;
  const subject = `New Inquiry #${id} — ${data.profile || '-'} / ${data.interest || '-'}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
      <h3 style="margin:0 0 8px">New Inquiry #${id}</h3>
      <p><b>Name:</b> ${data.first_name || ''} ${data.last_name || ''}</p>
      <p><b>Email:</b> ${data.email || '-'}</p>
      <p><b>Phone:</b> ${data.phone || '-'}</p>
      <p><b>Country:</b> ${data.country || '-'}</p>
      <p><b>Profile:</b> ${data.profile || '-'}</p>
      <p><b>Interest:</b> ${data.interest || '-'}</p>
      <p><b>Product hint:</b> ${data.product_hint || '-'}</p>
      <p><b>Est. annual volume:</b> ${data.est_annual_volume || '-'}</p>
      <p><b>Website:</b> ${data.business_website || '-'}</p>
      <p><b>Supplier tags:</b> ${data.supplier_tags || '-'}</p>
      <p><b>Message:</b><br>${(data.message || '').replace(/\n/g, '<br>')}</p>
    </div>
  `;
  // For leads you can still BCC yourself if you want
  const bcc = process.env.MAIL_BCC ? process.env.MAIL_BCC.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  return sendMail({ to, subject, html, bcc });
}

module.exports = { verifyTransport, sendMail, sendOtpEmail, sendLeadEmail };