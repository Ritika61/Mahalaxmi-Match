// src/middleware/security.js
const helmet = require('helmet');
const hpp = require('hpp');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

const isProd = process.env.NODE_ENV === 'production';

/* ------------ CORS allowlist (normalized) ------------ */
const allowListRaw = (process.env.CORS_ORIGINS || [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost',
  'http://127.0.0.1'
]).toString();

const ALLOWLIST = allowListRaw
  .split(',')
  .map(s => s.trim().toLowerCase().replace(/\/$/, ''))
  .filter(Boolean);

/* ------------ Helpers ------------ */
const isMutating = (req) => /^(POST|PUT|PATCH|DELETE)$/i.test(req.method);
const reAuth    = /^\/admin\/(login|otp|logout)(\/|$)/i;
const reHealth  = /^\/health(z)?$/i;
const reStatic  = /^\/(img|images|css|js|fonts|static|assets|favicon\.ico|robots\.txt)\b/i;

const shouldBypass = (req) => reAuth.test(req.path) || reHealth.test(req.path) || reStatic.test(req.path);

/* ------------ CORS ------------ */
const corsMw = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);       // same-origin nav/form/curl
    if (!isProd) return cb(null, true);       // dev: permissive

    const normalized = origin.toLowerCase().replace(/\/$/, '');
    const inAllow = ALLOWLIST.includes(normalized);
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);

    if (inAllow || isLocalhost) return cb(null, true);
    return cb(null, false);                   // disallowed → no CORS headers
  },
  credentials: true,
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','Accept','Origin'],
  optionsSuccessStatus: 204,
  preflightContinue: false
});

/* ------------ Helmet (CSP uses res.locals.cspNonce) ------------ */
const helmetMw = (req, res, next) => {
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        // Allow nonce'd inline scripts and Chart.js CDN
        "script-src": [
          "'self'",
          (rq, rs) => `'nonce-${rs.locals.cspNonce}'`,
          "https://cdn.jsdelivr.net"
        ],
        // Allow inline styles + common CSS CDNs + Google Fonts CSS
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com"
        ],
        // IMPORTANT: allow webfonts from both cdnjs and jsDelivr + Google fonts
        "font-src": [
          "'self'",
          "data:",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.gstatic.com"
        ],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": ["'self'"],
        "media-src": ["'self'"],
        "frame-src": ["'self'", "https://www.google.com", "https://maps.google.com"],
        "child-src": ["'self'", "https://www.google.com", "https://maps.google.com"],
        "form-action": ["'self'"]
      }
    }
  })(req, res, next);
};

const hppMw = hpp();

/* ------------ Rate limit / Slow down ------------ */
const _limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
const limiterGlobal = (req, res, next) => shouldBypass(req) ? next() : _limiter(req, res, next);

const _slow = slowDown({
  windowMs: 60_000,
  delayAfter: 120,
  delayMs: () => 500
});
const speedBump = (req, res, next) => (shouldBypass(req) || !isMutating(req)) ? next() : _slow(req, res, next);

module.exports = { corsMw, helmetMw, hppMw, limiterGlobal, speedBump };
