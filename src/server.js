// src/server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const crypto = require('crypto');

const { pool } = require('./db');
const { corsMw, helmetMw, hppMw, limiterGlobal, speedBump } = require('./middleware/security');

// Routers
const webRoutes          = require('./routes/web');
const productsRoutes     = require('./routes/products');
const contactRoutes      = require('./routes/contact');
const testimonialsRoutes = require('./routes/testimonials');
const adminRoutes        = require('./routes/admin');
const blogRoutes         = require('./routes/blog');

// Mail verify (optional)
let verifyTransport = null;
try { ({ verifyTransport } = require('./services/mail.service')); } catch {}

/* ---------- Constants ---------- */
const EBADCSRFTOKEN = 'EBADCSRFTOKEN';
const app    = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT   = Number(process.env.PORT || 3000);
const HOST   = process.env.HOST || '0.0.0.0';

console.log('[BOOT] NODE_ENV=%s HOST=%s PORT=%s', process.env.NODE_ENV, HOST, PORT);

/* ---------- Security / hardening ---------- */
app.set('trust proxy', isProd ? 1 : 0);  // only trust proxy in prod
app.disable('x-powered-by');

app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(hppMw);

/* IMPORTANT: create CSP nonce BEFORE Helmet so it can be used in CSP */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

/* Helmet (CSP), then CORS, limiters */
app.use(helmetMw);        // uses res.locals.cspNonce internally
app.use(corsMw);
app.use(limiterGlobal);
app.use(speedBump);

/* ---------- Parsers & static ---------- */
app.use(cookieParser(process.env.SESSION_SECRET || 'change_me'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,
  etag: true
}));

/* ---------- Views ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ---------- Sessions (MySQL-backed) ---------- */
let sessionStore;
try {
  sessionStore = new MySQLStore({}, pool);
  sessionStore.on('error', (e) => console.error('SESSION STORE ERROR:', e?.message || e));
  console.log('[BOOT] Session store initialised');
} catch (e) {
  console.error('[BOOT] Failed to init MySQL session store:', e?.message || e);
  process.exit(1);
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_me',
    resave: false,
    saveUninitialized: false,
    name: 'mi.sid',
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!isProd,
      maxAge: 1000 * 60 * 60 * 4, // 4h
    },
  })
);

/* ---------- App locals ---------- */
app.locals.site = { name: 'Jay Mahalaxmi Ind. Pvt. Ltd' };
app.use((req, res, next) => { res.locals.admin = req.session?.admin || null; next(); });

/* ---------- Health ---------- */
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/healthz', async (_req, res) => {
  const out = { ok: true, db: false, smtp: false };
  try { await pool.query('SELECT 1'); out.db = true; }
  catch (e) { out.ok = false; out.db_error = e?.message || String(e); }
  try { if (verifyTransport) await verifyTransport(); out.smtp = true; }
  catch (e) { out.ok = false; out.smtp_error = e?.message || String(e); }
  res.status(out.ok ? 200 : 503).json(out);
});

/* ---------- Dev sanity logs ---------- */
if (!isProd) {
  const typeOf = (m) => typeof m;
  console.log('webRoutes:', typeOf(webRoutes));
  console.log('productsRoutes:', typeOf(productsRoutes));
  console.log('contactRoutes:', typeOf(contactRoutes));
  console.log('testimonialsRoutes:', typeOf(testimonialsRoutes));
  console.log('adminRoutes:', typeOf(adminRoutes));
  console.log('blogRoutes:', typeOf(blogRoutes));
}

/* ---------- Route mount helper ---------- */
function mount(basePath, router, name) {
  if (typeof router !== 'function') {
    throw new Error(`${name} must export a router: use "module.exports = router"`);
  }
  app.use(basePath, router);
}

/* ---------- Routes ---------- */
mount('/',             webRoutes,          'webRoutes');
mount('/products',     productsRoutes,     'productsRoutes');
mount('/contact',      contactRoutes,      'contactRoutes');
mount('/testimonials', testimonialsRoutes, 'testimonialsRoutes');
mount('/admin',        adminRoutes,        'adminRoutes');
mount('/blog',         blogRoutes,         'blogRoutes');

/* ---------- 404 ---------- */
app.use((_req, res) => res.status(404).send('Not Found'));

/* ---------- CSRF error handler ---------- */
app.use((err, req, res, next) => {
  if (err && err.code === EBADCSRFTOKEN) {
    return res.status(403).send('Form expired or invalid. Please reload the page and try again.');
  }
  return next(err);
});

/* ---------- Error handler ---------- */
app.use((err, req, res, _next) => {
  console.error(err);
  if (!isProd) return res.status(500).send(`<pre>${err.stack || err}</pre>`);
  res.status(500).send('Server Error');
});

/* ---------- Start (non-blocking SMTP) ---------- */
console.log('[BOOT] Starting HTTP server…');
const server = app.listen(PORT, HOST, () => {
  const hostShown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`Listening on http://${hostShown}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`Tip: also reachable via your LAN IP on port ${PORT}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Change PORT or stop the other process.`);
  } else if (err.code === 'EACCES') {
    console.error(`Port ${PORT} requires elevated privileges. Try a higher port (e.g., 3000+).`);
  } else {
    console.error('Server listen error:', err);
  }
  process.exit(1);
});

// SMTP verify after boot
setTimeout(() => {
  if (!verifyTransport) return;
  verifyTransport()
    .then(() => console.log('[MAIL] SMTP verified'))
    .catch((e) => console.warn('[MAIL] SMTP verify failed (non-blocking):', e?.message || e));
}, 0);

/* ---------- Graceful shutdown ---------- */
function shutdown() {
  console.log('\nShutting down…');
  try { sessionStore?.close?.(); } catch {}
  try { pool?.end?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException',  (e) => console.error('[uncaughtException]', e));
