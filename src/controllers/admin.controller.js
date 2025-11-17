// src/controllers/admin.controller.js
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const { randomUUID, randomInt } = require('crypto');
const multer = require('multer');
const Joi = require('joi');

const { pool } = require('../db');
const { sendOtpEmail } = require('../services/mail.service'); // must export sendOtpEmail(email, code, ttlMins)

/* ────────────────────────────────────────────────────────────
   Small utils
──────────────────────────────────────────────────────────── */
const isProd = process.env.NODE_ENV === 'production';

function ensureCsrf(req, res) {
  return res.locals.csrfToken || (typeof req.csrfToken === 'function' ? req.csrfToken() : undefined);
}

function normalizeSlug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseSpecs(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  try { const obj = JSON.parse(raw); if (obj && typeof obj === 'object') return obj; } catch {}
  const obj = {};
  raw.split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) obj[k] = v;
    }
  });
  return Object.keys(obj).length ? obj : null;
}

function specsToTextarea(specs) {
  if (!specs) return '';
  if (typeof specs === 'string') return specs;
  try { return JSON.stringify(specs, null, 2); } catch { return ''; }
}

function normalizeImagePath(raw) {
  let p = (raw || '').toString().trim();
  if (!p) return null;
  p = p.replace(/\\/g, '/');
  const m = p.match(/\/public(\/.+)$/i);
  if (m) p = m[1];
  if (/^https?:\/\//i.test(p)) return p;
  if (!p.startsWith('/')) p = '/' + p;
  if (!/^\/img\//.test(p)) p = '/img/products/' + p.split('/').pop();
  return p;
}

/** Convert any date-ish value to MySQL DATETIME string (UTC) */
function toMySQLDateTime(value, { fallbackNow = false } = {}) {
  if (!value) return fallbackNow ? new Date().toISOString().slice(0,19).replace('T',' ') : null;
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return fallbackNow ? new Date().toISOString().slice(0,19).replace('T',' ') : null;
  }
  return d.toISOString().slice(0,19).replace('T',' ');
}

/* ────────────────────────────────────────────────────────────
   Uploads (product images)
──────────────────────────────────────────────────────────── */
const uploadDirAbs = path.join(__dirname, '..', 'public', 'img', 'products');
if (!fs.existsSync(uploadDirAbs)) fs.mkdirSync(uploadDirAbs, { recursive: true });

const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png' : '.png',
  'image/webp': '.webp',
  'image/gif' : '.gif'
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDirAbs),
  filename: (_req, file, cb) => {
    const ext = EXT_MAP[file.mimetype] || (path.extname(file.originalname || '') || '.bin');
    cb(null, `${randomUUID()}${ext}`);
  }
});
const fileFilter = (_req, file, cb) => {
  const ok = Boolean(EXT_MAP[file.mimetype]);
  cb(ok ? null : new Error('Only images (jpg, png, webp, gif) are allowed'), ok);
};

exports.uploadImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 }
});

/* ────────────────────────────────────────────────────────────
   AUTH  (Password → Verify OTP → Dashboard)
──────────────────────────────────────────────────────────── */
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const genOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Send email with timeout to avoid long hangs */
async function sendOtpWithTimeout(email, code, ttlMins = 5, timeoutMs = 8000) {
  const to = String(email || '').trim();
  if (!to) return false;

  const sender = async () => {
    const res = await sendOtpEmail(to, code, ttlMins); // should throw on failure or return info
    // treat any truthy as success
    return !!res || true;
  };

  const timeout = new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error('MAIL_TIMEOUT')), timeoutMs)
  );

  try {
    const ok = await Promise.race([sender(), timeout]);
    return !!ok;
  } catch (e) {
    console.error('[MAIL] OTP send failed:', e && e.message ? e.message : e);
    return false;
  }
}

exports.loginForm = (req, res) => {
  res.render('admin/login', { title: 'Admin Login', csrfToken: ensureCsrf(req, res) });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).render('admin/login', {
        title: 'Admin Login',
        error: 'Email and password required.',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, pass_hash, is_active, failed_attempts, lock_until
         FROM admin_users WHERE email=? LIMIT 1`,
      [email]
    ) || [ [null] ];

    if (!user || !user.is_active) {
      return res.status(401).render('admin/login', {
        title: 'Admin Login',
        error: 'Invalid credentials.',
        csrfToken: ensureCsrf(req, res)
      });
    }

    if (user.lock_until && new Date(user.lock_until) > new Date()) {
      return res.status(423).render('admin/login', {
        title: 'Admin Login',
        error: 'Account temporarily locked. Try again later.',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const ok = await bcrypt.compare(password, user.pass_hash);
    if (!ok) {
      await pool.query(
        `UPDATE admin_users
           SET failed_attempts = failed_attempts + 1,
               lock_until = CASE WHEN failed_attempts + 1 >= 5
                                 THEN DATE_ADD(NOW(), INTERVAL 10 MINUTE)
                                 ELSE lock_until END
         WHERE id=?`,
        [user.id]
      );
      return res.status(401).render('admin/login', {
        title: 'Admin Login',
        error: 'Invalid credentials.',
        csrfToken: ensureCsrf(req, res)
      });
    }

    await pool.query(`UPDATE admin_users SET failed_attempts=0, lock_until=NULL WHERE id=?`, [user.id]);

    // Create OTP & stash in session
    const code = genOtp();
    req.session.pendingAdmin = { id: user.id, email: user.email };
    req.session.otp = { code, exp: Date.now() + OTP_TTL_MS, tries: 0 };

    // Try to send email, but don't hang forever
    let mailed = false;
    if (process.env.SMTP_DISABLE === '1') {
      console.warn('[MAIL] SMTP_DISABLE=1 → skipping email send. OTP:', code);
      mailed = true; // pretend success in dev
    } else {
      mailed = await sendOtpWithTimeout(user.email, code, 5, 8000);
      if (!mailed && !isProd) {
        console.warn('[DEV] OTP fallback (email failed):', code);
        mailed = true; // let dev proceed
      }
    }

    if (!mailed) {
      // Hard fail only in production
      req.session.pendingAdmin = null;
      req.session.otp = null;
      return res.status(502).render('admin/login', {
        title: 'Admin Login',
        error: 'Email delivery issue. Please try again later.',
        csrfToken: ensureCsrf(req, res)
      });
    }

    // Save then redirect to /admin/otp
    return req.session.save(() => res.redirect('/admin/otp'));
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).render('admin/login', {
      title: 'Admin Login',
      error: 'Server error. Please try again.',
      csrfToken: ensureCsrf(req, res)
    });
  }
};

exports.otpForm = (req, res) => {
  if (!req.session.pendingAdmin || !req.session.otp) return res.redirect('/admin/login');
  res.render('admin/otp', {
    title: 'Verify OTP',
    csrfToken: ensureCsrf(req, res),
    email: req.session.pendingAdmin.email,
    // show dev code if you want to print it in the template (optional)
    devCode: isProd ? null : req.session.otp.code
  });
};

exports.otpVerify = async (req, res) => {
  const pending = req.session.pendingAdmin;
  const otp = req.session.otp;
  if (!pending || !otp) return res.redirect('/admin/login');

  const code = String(req.body.code || '').trim();

  if (Date.now() > otp.exp) {
    req.session.pendingAdmin = null;
    req.session.otp = null;
    return res.status(400).render('admin/login', {
      title: 'Admin Login',
      error: 'OTP expired. Please sign in again.',
      csrfToken: ensureCsrf(req, res)
    });
  }

  if (code !== otp.code) {
    otp.tries = (otp.tries || 0) + 1;
    if (otp.tries >= 5) {
      req.session.pendingAdmin = null;
      req.session.otp = null;
      return res.status(400).render('admin/login', {
        title: 'Admin Login',
        error: 'Too many invalid attempts. Please sign in again.',
        csrfToken: ensureCsrf(req, res)
      });
    }
    return res.status(400).render('admin/otp', {
      title: 'Verify OTP',
      error: 'Invalid code. Try again.',
      csrfToken: ensureCsrf(req, res),
      email: pending.email,
      devCode: isProd ? null : otp.code
    });
  }

  req.session.admin = { id: pending.id, email: pending.email };
  req.session.pendingAdmin = null;
  req.session.otp = null;

  const nextUrl = req.session.returnTo || '/admin';
  delete req.session.returnTo;
  return res.redirect(nextUrl);
};

exports.logout = (req, res) => {
  req.session.admin = null;
  req.session.pendingAdmin = null;
  req.session.otp = null;
  req.session.destroy?.(() => {});
  res.redirect('/admin/login');
};

/* ────────────────────────────────────────────────────────────
   Dashboard helpers (safe table checks + series builder)
──────────────────────────────────────────────────────────── */
async function tableExists(tableName) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(r?.n || 0) > 0;
}

function lastNDaysLabels(n = 30) {
  const out = [];
  const d = new Date();
  d.setHours(0,0,0,0);
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d);
    dt.setDate(d.getDate() - i);
    out.push(dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }));
  }
  return out;
}

/** Build local YYYY-MM-DD strings to match MySQL DATE_FORMAT(...,'%Y-%m-%d') */
function daysKeyArray(n = 30) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0); // local midnight
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d);
    dt.setDate(d.getDate() - i);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/**
 * Build count series per day for the last N days.
 * Uses DATE_FORMAT(...,'%Y-%m-%d') and groups by the formatted string
 * → avoids ONLY_FULL_GROUP_BY issues.
 */
async function buildDailySeries(table, dateExpr = 'created_at', days = 30, whereExpr = '') {
  const exists = await tableExists(table);
  if (!exists) return Array(days).fill(0);

  const sinceSql = `DATE(${dateExpr}) >= (CURDATE() - INTERVAL ${days - 1} DAY)`;
  const where = whereExpr ? ` AND (${whereExpr})` : '';

  const sql = `
    SELECT
      DATE_FORMAT(${dateExpr}, '%Y-%m-%d') AS d,
      COUNT(*) AS c
    FROM \`${table}\`
    WHERE ${sinceSql}${where}
    GROUP BY d
    ORDER BY d ASC
  `;

  const [rows] = await pool.query(sql);
  const keys = daysKeyArray(days);
  const map  = new Map(rows.map(r => [r.d, Number(r.c)]));
  return keys.map(k => map.get(k) || 0);
}

async function safeCount(table, whereExpr = '1=1') {
  const exists = await tableExists(table);
  if (!exists) return 0;
  const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${whereExpr}`);
  return Number(r?.n || 0);
}

/** tiny helpers to avoid crashing if table/column missing */
async function safeScalar(sql, params = [], fallback = 0) {
  try {
    const [rows] = await pool.query(sql, params);
    const row = rows && rows[0];
    if (!row) return fallback;
    const val = Object.values(row)[0];
    return Number(val) || 0;
  } catch {
    return fallback;
  }
}
async function safeRows(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────
   Dashboard
──────────────────────────────────────────────────────────── */
exports.dashboard = async (req, res, next) => {
  try {
    const email = req.session?.admin?.email || '';
    const adminUsername = email ? email.split('@')[0] : 'Admin';

    const DAYS = 90;
    const labels = lastNDaysLabels(DAYS);

    const totalProducts      = await safeCount('products');
    const totalTestimonials  = await safeCount('testimonials');
    const totalBlogPosts     = await safeCount('blog_posts');
    const totalContacts      = await safeCount('contacts');

    const productsSeries     = await buildDailySeries('products',     'created_at', DAYS);
    const testimonialsSeries = await buildDailySeries('testimonials', 'created_at', DAYS);
    const blogSeries         = await buildDailySeries('blog_posts',   'COALESCE(published_at, created_at)', DAYS);
    const contactsSeries     = await buildDailySeries('contacts',     'created_at', DAYS);

    const [rows] = await pool.query(
      'SELECT id, name, slug, active, created_at FROM products ORDER BY created_at DESC LIMIT 100'
    );

    /* ── NEW: KPI tiles + Recent Activity (safe) ─────────── */
    const newProductsToday = await safeScalar(
      `SELECT COUNT(*) AS c FROM products WHERE DATE(created_at)=CURDATE()`
    );
    const blogThisWeek = await safeScalar(
      `SELECT COUNT(*) AS c FROM blog_posts WHERE YEARWEEK(COALESCE(published_at,created_at))=YEARWEEK(CURDATE())`
    );
    const testiThisMonth = await safeScalar(
      `SELECT COUNT(*) AS c FROM testimonials WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`
    );

    const raProducts  = await safeRows(`
      SELECT 'Product added' title, CONCAT(name,' (',slug,')') detail, created_at ts
      FROM products ORDER BY created_at DESC LIMIT 4`);
    const raBlog      = await safeRows(`
      SELECT 'Blog published' title, title detail, COALESCE(published_at,created_at) ts
      FROM blog_posts ORDER BY COALESCE(published_at,created_at) DESC LIMIT 4`);
    const raContacts  = await safeRows(`
      SELECT 'New message' title, email detail, created_at ts
      FROM contacts ORDER BY created_at DESC LIMIT 4`);
    const raTesti     = await safeRows(`
      SELECT 'Testimonial' title, name detail, created_at ts
      FROM testimonials ORDER BY created_at DESC LIMIT 4`);

    const recentActivity = [...raProducts, ...raBlog, ...raContacts, ...raTesti]
      .sort((a,b)=> new Date(b.ts)-new Date(a.ts))
      .slice(0,12)
      .map(x=>({
        title:x.title,
        detail:x.detail || '',
        when:new Date(x.ts).toLocaleString('en-US',{
          month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
        })
      }));

    return res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      adminUsername,
      totalProducts,
      totalTestimonials,
      totalBlogPosts,
      totalContacts,
      labels,
      productsSeries,
      testimonialsSeries,
      blogSeries,
      contactsSeries,
      items: rows,
      // NEW props for the view
      newProductsToday,
      blogThisWeek,
      testiThisMonth,
      recentActivity,
      active: res.locals.active || 'dashboard',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) {
    console.error('DASHBOARD ERROR:', e);
    next(e);
  }
};

/* ────────────────────────────────────────────────────────────
   Recycle Bin (helpers + handlers)
──────────────────────────────────────────────────────────── */
async function recycleSave(entityType, originalId, name, row, deletedByEmail) {
  const payloadStr = JSON.stringify(row || {});
  await pool.query(
    `INSERT INTO recycle_bin (entity_type, original_id, name, payload, deleted_by)
     VALUES (?, ?, ?, ?, ?)`,
    [entityType, originalId || null, name || null, payloadStr, deletedByEmail || null]
  );
}

async function tableHasColumn(tableName, columnName) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(r?.n || 0) > 0;
}

/* ===== RESTORE HELPERS ===== */
async function restoreProduct(payload) {
  const { name, slug, category, short_desc, description, specs, image, active } = payload || {};

  let finalSlug = (slug || '').trim();
  if (!finalSlug) finalSlug = 'restored-' + Date.now();

  const [[slugRow]] = await pool.query('SELECT id FROM products WHERE slug=? LIMIT 1', [finalSlug]);
  if (slugRow) finalSlug = `${finalSlug}-restored-${Date.now()}`;

  await pool.query(
    `INSERT INTO products
     (name, slug, category, short_desc, description, specs, image, active)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      name || 'Restored',
      finalSlug,
      category || 'Uncategorized',
      short_desc || '',
      description || '',
      (typeof specs === 'object' ? JSON.stringify(specs) : (specs || null)),
      image || null,
      (active ? 1 : 0)
    ]
  );
}

async function restoreTestimonial(payload) {
  const hasApproved = await tableHasColumn('testimonials', 'approved');
  const created = toMySQLDateTime(payload?.created_at, { fallbackNow: true });

  if (hasApproved) {
    const { name, rating, comment, approved } = payload || {};
    await pool.query(
      `INSERT INTO testimonials (name, rating, comment, approved, created_at)
       VALUES (?,?,?,?,?)`,
      [name || 'Restored', Number(rating) || 5, comment || '', approved ? 1 : 0, created]
    );
  } else {
    const { name, rating, comment, status } = payload || {};
    await pool.query(
      `INSERT INTO testimonials (name, rating, comment, status, created_at)
       VALUES (?,?,?,?,?)`,
      [name || 'Restored', Number(rating) || 5, comment || '', status || 'pending', created]
    );
  }
}

async function restoreBlogPost(payload) {
  const {
    slug, title, excerpt, html, image, tag_slug, tag_name, read_mins, published_at, created_at
  } = payload || {};

  let finalSlug = (slug || '').trim() || ('restored-' + Date.now());
  const [[dupe]] = await pool.query('SELECT id FROM blog_posts WHERE slug=? LIMIT 1', [finalSlug]);
  if (dupe) finalSlug = `${finalSlug}-restored-${Date.now()}`;

  const published = toMySQLDateTime(published_at, { fallbackNow: false });
  const created   = toMySQLDateTime(created_at,   { fallbackNow: true  });

  await pool.query(
    `INSERT INTO blog_posts
     (slug, title, excerpt, html, image, tag_slug, tag_name, read_mins, published_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      finalSlug,
      title || 'Restored Post',
      excerpt || null,
      html || null,
      image || null,
      tag_slug || null,
      tag_name || null,
      read_mins || null,
      published || null,
      created
    ]
  );
}

async function restoreMessage(payload) {
  const { name, email, country, Company, message, created_at } = payload || {};
  const created = toMySQLDateTime(created_at, { fallbackNow: true });

  await pool.query(
    `INSERT INTO contacts (name, email, country, \`Company\`, message, created_at)
     VALUES (?,?,?,?,?,?)`,
    [name || 'Restored', email || null, country || null, Company || null, message || null, created]
  );
}

exports.recycleList = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, entity_type, original_id, name, deleted_by, deleted_at
         FROM recycle_bin
        ORDER BY deleted_at DESC, id DESC
        LIMIT 500`
    );
    res.render('admin/recycle-list', {
      title: 'Recently Deleted',
      items: rows || [],
      active: 'recycle',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.recycleRestore = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/recycle');

    const [[row]] = await pool.query(
      `SELECT id, entity_type, payload FROM recycle_bin WHERE id=? LIMIT 1`, [id]
    );
    if (!row) return res.redirect('/admin/recycle');

    const payload = (row.payload && typeof row.payload === 'object')
      ? row.payload
      : JSON.parse(row.payload || '{}');

    const type = row.entity_type;

    if (type === 'products')          await restoreProduct(payload);
    else if (type === 'testimonials') await restoreTestimonial(payload);
    else if (type === 'blog_posts')   await restoreBlogPost(payload);
    else if (type === 'contacts')     await restoreMessage(payload);

    await pool.query('DELETE FROM recycle_bin WHERE id=?', [id]);
    res.redirect('/admin/recycle');
  } catch (e) { next(e); }
};

exports.recycleDeleteForever = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/recycle');
    await pool.query('DELETE FROM recycle_bin WHERE id=?', [id]);
    res.redirect('/admin/recycle');
  } catch (e) { next(e); }
};

/* ────────────────────────────────────────────────────────────
   Products: create / edit / update / delete (soft delete)
──────────────────────────────────────────────────────────── */
const productSchema = Joi.object({
  name: Joi.string().max(120).required(),
  slug: Joi.string().max(140).pattern(/^[a-z0-9-]+$/).required(),
  category: Joi.string().max(60).required(),
  short_desc: Joi.string().max(255).required(),
  description: Joi.string().max(4000).allow('').default(''),
  specs: Joi.string().allow('').default(''),
  active: Joi.number().valid(0, 1).default(1)
});

exports.productForm = (req, res) => {
  res.render('admin/products-new', {
    title: 'Add Product',
    active: res.locals.active || 'products',
    csrfToken: ensureCsrf(req, res)
  });
};

exports.productCreate = async (req, res, next) => {
  const cleanup = (fp) => { try { if (fp) fs.unlinkSync(path.join(uploadDirAbs, path.basename(fp))); } catch {} };
  try {
    const imgFile = req.file ? `/img/products/${req.file.filename}` : null;

    if (req.body && typeof req.body.slug === 'string') {
      req.body.slug = normalizeSlug(req.body.slug);
    }

    const { value, error } = productSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      cleanup(imgFile);
      return res.status(400).render('admin/products-new', {
        title: 'Add Product',
        error: error.details.map(d => d.message).join('<br>'),
        active: 'products',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const specsJSON = parseSpecs(value.specs);

    await pool.query(
      `INSERT INTO products
       (name,slug,category,short_desc,description,specs,image,active)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        value.name,
        value.slug,
        value.category,
        value.short_desc,
        value.description,
        specsJSON ? JSON.stringify(specsJSON) : null,
        imgFile,
        value.active ? 1 : 0
      ]
    );

    res.redirect('/admin/products');
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('admin/products-new', {
        title: 'Add Product',
        error: 'Slug already exists. Please choose a different slug.',
        active: 'products',
        csrfToken: ensureCsrf(req, res)
      });
    }
    next(e);
  }
};

exports.productEditForm = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/products');

    const [[row]] = await pool.query(
      'SELECT id, name, slug, category, short_desc, description, specs, image, active FROM products WHERE id=? LIMIT 1',
      [id]
    );
    if (!row) return res.redirect('/admin/products');

    const specsText = row.specs ? specsToTextarea(typeof row.specs === 'string' ? JSON.parse(row.specs) : row.specs) : '';

    res.render('admin/products-edit', {
      title: 'Edit Product',
      item: { ...row, image: normalizeImagePath(row.image), specs: specsText },
      active: 'products',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.productUpdate = async (req, res, next) => {
  const cleanup = (fp) => { try { if (fp) fs.unlinkSync(path.join(uploadDirAbs, path.basename(fp))); } catch {} };
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/products');

    if (req.body && typeof req.body.slug === 'string') {
      req.body.slug = normalizeSlug(req.body.slug);
    }

    const { value, error } = productSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      cleanup(req.file && `/img/products/${req.file.filename}`);
      return res.status(400).render('admin/products-edit', {
        title: 'Edit Product',
        item: { id, ...req.body, image: null },
        error: error.details.map(d => d.message).join('<br>'),
        active: 'products',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const [[current]] = await pool.query('SELECT image FROM products WHERE id=? LIMIT 1', [id]);

    const specsJSON = parseSpecs(value.specs);

    let imgPath = current?.image || null;
    if (req.file) {
      imgPath = `/img/products/${req.file.filename}`;
    }

    await pool.query(
      `UPDATE products SET
         name=?, slug=?, category=?, short_desc=?, description=?,
         specs=?, image=?, active=?
       WHERE id=?`,
      [
        value.name,
        value.slug,
        value.category,
        value.short_desc,
        value.description,
        specsJSON ? JSON.stringify(specsJSON) : null,
        imgPath,
        value.active ? 1 : 0,
        id
      ]
    );

    res.redirect('/admin/products');
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('admin/products-edit', {
        title: 'Edit Product',
        item: { id: Number(req.params.id), ...req.body },
        error: 'Slug already exists. Please choose a different slug.',
        active: 'products',
        csrfToken: ensureCsrf(req, res)
      });
    }
    cleanup(req.file && `/img/products/${req.file.filename}`);
    next(e);
  }
};

// SOFT DELETE: snapshot → recycle_bin, then remove original
exports.productDelete = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/products');

    const [[row]] = await pool.query(
      'SELECT id, name, slug, category, short_desc, description, specs, image, active FROM products WHERE id=? LIMIT 1',
      [id]
    );
    if (!row) return res.redirect('/admin/products');

    const adminEmail = (req.session && req.session.admin && req.session.admin.email) || null;
    await recycleSave('products', row.id, row.name, row, adminEmail);

    await pool.query('DELETE FROM products WHERE id=?', [id]);
    res.redirect('/admin/products');
  } catch (e) { next(e); }
};

/* ────────────────────────────────────────────────────────────
   TESTIMONIALS — Admin moderation (soft delete)
──────────────────────────────────────────────────────────── */
function normalizeStatus(v) {
  const allowed = new Set(['all', 'pending', 'approved', 'rejected']);
  const s = String(v || '').toLowerCase();
  return allowed.has(s) ? s : 'all';
}

exports.testimonialsList = async (req, res, next) => {
  try {
    const status = normalizeStatus(req.query.status);
    const hasApproved = await tableHasColumn('testimonials', 'approved');

    let sql = `
      SELECT id, name, rating, comment AS message,
             ${hasApproved ? 'CASE WHEN approved=1 THEN "approved" ELSE "pending" END' : 'status'} AS status,
             created_at
        FROM testimonials
    `;
    const params = [];
    if (status !== 'all') {
      sql += ' WHERE ' + (hasApproved
        ? (status === 'approved' ? 'approved = 1' : 'approved = 0')
        : 'status = ?');
      if (!hasApproved) params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 500';

    const [rows] = await pool.query(sql, params);

    res.render('admin/testimonials-list', {
      title: 'Testimonials',
      items: rows || [],
      status,
      active: 'testimonials',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.testimonialApprove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.redirect('/admin/testimonials');
    const hasApproved = await tableHasColumn('testimonials', 'approved');
    if (hasApproved) {
      await pool.query('UPDATE testimonials SET approved=1 WHERE id=?', [id]);
    } else {
      await pool.query('UPDATE testimonials SET status="approved" WHERE id=?', [id]);
    }
    const backStatus = normalizeStatus(req.query.status);
    return res.redirect(`/admin/testimonials?status=${encodeURIComponent(backStatus)}`);
  } catch (e) { next(e); }
};

exports.testimonialReject = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.redirect('/admin/testimonials');
    const hasApproved = await tableHasColumn('testimonials', 'approved');
    if (hasApproved) {
      await pool.query('UPDATE testimonials SET approved=0 WHERE id=?', [id]);
    } else {
      await pool.query('UPDATE testimonials SET status="rejected" WHERE id=?', [id]);
    }
    const backStatus = normalizeStatus(req.query.status);
    return res.redirect(`/admin/testimonials?status=${encodeURIComponent(backStatus)}`);
  } catch (e) { next(e); }
};

// SOFT DELETE
exports.testimonialDelete = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.redirect('/admin/testimonials');

    const hasApproved = await tableHasColumn('testimonials', 'approved');
    const selectSql = hasApproved
      ? `SELECT id, name, rating, comment, approved, created_at FROM testimonials WHERE id=? LIMIT 1`
      : `SELECT id, name, rating, comment, status,   created_at FROM testimonials WHERE id=? LIMIT 1`;

    const [[row]] = await pool.query(selectSql, [id]);
    if (!row) return res.redirect('/admin/testimonials');

    const adminEmail = (req.session?.admin?.email) || null;
    await recycleSave('testimonials', row.id, row.name, row, adminEmail);

    await pool.query('DELETE FROM testimonials WHERE id=?', [id]);

    const backStatus = normalizeStatus(req.query.status);
    return res.redirect(`/admin/testimonials?status=${encodeURIComponent(backStatus)}`);
  } catch (e) { next(e); }
};

/* ───────────────────────────────────────────────────────────
   BLOG (admin)  — soft delete + publish/unpublish
────────────────────────────────────────────────────────── */
const blogUploadDirAbs = path.join(__dirname, '..', 'public', 'img', 'blog');
if (!fs.existsSync(blogUploadDirAbs)) fs.mkdirSync(blogUploadDirAbs, { recursive: true });

const blogStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, blogUploadDirAbs),
  filename: (_req, file, cb) => {
    const ext = EXT_MAP[file.mimetype] || (path.extname(file.originalname || '') || '.bin');
    cb(null, `${randomUUID()}${ext}`);
  }
});
exports.uploadBlogImage = multer({
  storage: blogStorage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 }
});

const blogSchema = Joi.object({
  title: Joi.string().max(200).required(),
  slug: Joi.string().max(160).pattern(/^[a-z0-9-]+$/).required(),
  excerpt: Joi.string().max(400).allow('').default(''),
  html: Joi.string().allow('').default(''),
  tag_slug: Joi.string().max(80).allow('').default(''),
  tag_name: Joi.string().max(80).allow('').default(''),
  read_mins: Joi.number().integer().min(1).max(60).allow('', null).default(null),
  publish: Joi.string().valid('1').optional()
});

exports.blogList = async (req, res, next) => {
  try {
    const allowed = new Set(['all', 'published', 'draft']);
    const filter = allowed.has(String(req.query.filter)) ? String(req.query.filter) : 'all';

    let sql = `
      SELECT id, title, slug, excerpt, image, tag_name, read_mins, published_at, created_at
        FROM blog_posts
    `;
    if (filter === 'published') sql += ' WHERE published_at IS NOT NULL';
    if (filter === 'draft')     sql += ' WHERE published_at IS NULL';
    sql += ' ORDER BY COALESCE(published_at, created_at) DESC, id DESC';

    const [rows] = await pool.query(sql);
    res.render('admin/blog-list', {
      title: 'Blog',
      items: rows || [],
      filter,
      active: 'blog',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.blogNewForm = (req, res) => {
  res.render('admin/blog-new', {
    title: 'New Post',
    active: 'blog',
    csrfToken: ensureCsrf(req, res),
    data: {}
  });
};

exports.blogCreate = async (req, res, next) => {
  const cleanup = (fpath) => { try { if (fpath) fs.unlinkSync(path.join(blogUploadDirAbs, path.basename(fpath))); } catch {} };
  try {
    if (req.body && typeof req.body.slug === 'string') req.body.slug = normalizeSlug(req.body.slug);

    const { value, error } = blogSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      cleanup(req.file && `/img/blog/${req.file.filename}`);
      return res.status(400).render('admin/blog-new', {
        title: 'New Post',
        error: error.details.map(d => d.message).join('<br>'),
        data: req.body,
        active: 'blog',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const imgPath = req.file ? `/img/blog/${req.file.filename}` : null;
    const publishNow = value.publish === '1';

    await pool.query(
      `INSERT INTO blog_posts
       (slug, title, excerpt, html, image, tag_slug, tag_name, read_mins, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.slug,
        value.title,
        value.excerpt || null,
        value.html || null,
        imgPath,
        value.tag_slug || null,
        value.tag_name || null,
        value.read_mins || null,
        publishNow ? new Date() : null
      ]
    );

    res.redirect('/admin/blog');
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('admin/blog-new', {
        title: 'New Post',
        error: 'Slug already exists. Please choose a different slug.',
        data: req.body,
        active: 'blog',
        csrfToken: ensureCsrf(req, res)
      });
    }
    next(e);
  }
};

exports.blogEditForm = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query(
      `SELECT id, slug, title, excerpt, html, image, tag_slug, tag_name, read_mins, published_at, created_at
         FROM blog_posts WHERE id=? LIMIT 1`, [id]
    );
    if (!row) return res.redirect('/admin/blog');

    res.render('admin/blog-edit', {
      title: 'Edit Post',
      item: row,
      active: 'blog',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.blogUpdate = async (req, res, next) => {
  const cleanup = (fpath) => { try { if (fpath) fs.unlinkSync(path.join(blogUploadDirAbs, path.basename(fpath))); } catch {} };
  try {
    const id = Number(req.params.id);
    if (req.body && typeof req.body.slug === 'string') req.body.slug = normalizeSlug(req.body.slug);

    const { value, error } = blogSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      cleanup(req.file && `/img/blog/${req.file.filename}`);
      return res.status(400).render('admin/blog-edit', {
        title: 'Edit Post',
        error: error.details.map(d => d.message).join('<br>'),
        item: { id, ...req.body },
        active: 'blog',
        csrfToken: ensureCsrf(req, res)
      });
    }

    const [[current]] = await pool.query('SELECT image FROM blog_posts WHERE id=?', [id]);
    let imgPath = current?.image || null;
    if (req.file) {
      imgPath = `/img/blog/${req.file.filename}`;
    }

    await pool.query(
      `UPDATE blog_posts
         SET slug=?, title=?, excerpt=?, html=?, image=?, tag_slug=?, tag_name=?, read_mins=?
       WHERE id=?`,
      [
        value.slug,
        value.title,
        value.excerpt || null,
        value.html || null,
        imgPath,
        value.tag_slug || null,
        value.tag_name || null,
        value.read_mins || null,
        id
      ]
    );

    res.redirect('/admin/blog');
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('admin/blog-edit', {
        title: 'Edit Post',
        error: 'Slug already exists. Please choose a different slug.',
        item: { id: Number(req.params.id), ...req.body },
        active: 'blog',
        csrfToken: ensureCsrf(req, res)
      });
    }
    next(e);
  }
};

// PUBLISH
exports.blogPublish = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const now = toMySQLDateTime(new Date(), { fallbackNow: true });
    await pool.query('UPDATE blog_posts SET published_at=? WHERE id=?', [now, id]);
    const back = req.query.filter ? `?filter=${encodeURIComponent(req.query.filter)}` : '';
    res.redirect('/admin/blog' + back);
  } catch (e) { next(e); }
};

// UNPUBLISH
exports.blogUnpublish = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query('UPDATE blog_posts SET published_at=NULL WHERE id=?', [id]);
    const back = req.query.filter ? `?filter=${encodeURIComponent(req.query.filter)}` : '';
    res.redirect('/admin/blog' + back);
  } catch (e) { next(e); }
};

// SOFT DELETE blog post
exports.blogDelete = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query(
      `SELECT id, slug, title, excerpt, html, image, tag_slug, tag_name, read_mins, published_at, created_at
         FROM blog_posts WHERE id=? LIMIT 1`, [id]
    );
    if (row) {
      const adminEmail = (req.session?.admin?.email) || null;
      await recycleSave('blog_posts', row.id, row.title, row, adminEmail);
      await pool.query('DELETE FROM blog_posts WHERE id=?', [id]);
    }
    const back = req.query.filter ? `?filter=${encodeURIComponent(req.query.filter)}` : '';
    res.redirect('/admin/blog' + back);
  } catch (e) { next(e); }
};

/* ── CONTACT MESSAGES (admin) — soft delete ─────────────── */
exports.messagesList = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         name,
         email,
         country,
         \`Company\` AS company,
         LEFT(message, 240) AS preview,
         created_at
       FROM contacts
       ORDER BY created_at DESC, id DESC
       LIMIT 500`
    );

    res.render('admin/messages-list', {
      title: 'Messages',
      items: rows || [],
      active: 'messages',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

exports.messageView = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/messages');

    const [[row]] = await pool.query(
      `SELECT
         id,
         name,
         email,
         country,
         \`Company\` AS company,
         message,
         created_at
       FROM contacts
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!row) return res.redirect('/admin/messages');

    res.render('admin/message-view', {
      title: 'Message',
      item: row,
      active: 'messages',
      csrfToken: ensureCsrf(req, res)
    });
  } catch (e) { next(e); }
};

// SOFT DELETE contact message
exports.messageDelete = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.redirect('/admin/messages');

    const [[row]] = await pool.query(
      `SELECT id, name, email, country, \`Company\` AS Company, message, created_at
         FROM contacts WHERE id=? LIMIT 1`, [id]
    );
    if (row) {
      const adminEmail = (req.session?.admin?.email) || null;
      await recycleSave('contacts', row.id, row.name, row, adminEmail);
      await pool.query('DELETE FROM contacts WHERE id=?', [id]);
    }
    res.redirect('/admin/messages');
  } catch (e) { next(e); }
};
