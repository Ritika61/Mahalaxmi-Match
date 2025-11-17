// src/routes/admin.js
const express = require('express');
const router = express.Router();
const csrf = require('csurf');

const admin = require('../controllers/admin.controller');
const { pool } = require('../db');

/* ────────────────────────────────────────────────────────────
   CSRF
   - We use session-based tokens (server already has session+cookies).
   - setCsrf exposes res.locals.csrfToken for EJS forms.
──────────────────────────────────────────────────────────── */
const csrfProtection = csrf();
const setCsrf = (req, res, next) => {
  // Only attach if the token API exists for this request (i.e., csrfProtection ran)
  if (typeof req.csrfToken === 'function') {
    try { res.locals.csrfToken = req.csrfToken(); } catch {}
  }
  next();
};

/* ────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.admin) return res.redirect('/admin');
  return next();
}

function withHeader(activeTab) {
  return (_req, res, next) => {
    res.locals.active = activeTab;
    next();
  };
}

function normalizeApprovedFilter(v) {
  const s = String(v || '').toLowerCase().trim();
  return (s === 'approved' || s === 'pending' || s === 'all') ? s : 'all';
}

/* ────────────────────────────────────────────────────────────
   Dev guard
──────────────────────────────────────────────────────────── */
const isProd = process.env.NODE_ENV === 'production';
function must(fn, label) {
  if (typeof fn === 'function') return fn;
  if (!isProd) {
    console.error('[routes] handler not a function:', label, '=>', typeof fn);
    return (req, res) => res.status(500).send(`[routes] Handler not a function: ${label}`);
  }
  return (_req, res) => res.status(500).send('Server misconfiguration (handler missing).');
}

/* ────────────────────────────────────────────────────────────
   Auth (Password → OTP → Dashboard)
   Order: redirectIfAuthed → csrfProtection → setCsrf → handler
──────────────────────────────────────────────────────────── */
router.get(
  '/login',
  redirectIfAuthed,
  csrfProtection,
  setCsrf,
  (_req, res) => res.render('admin/login', { title: 'Admin Login' })
);

// POST must validate CSRF before doing anything
router.post(
  '/login',
  redirectIfAuthed,
  csrfProtection,
  setCsrf,
  must(admin.login, 'admin.login')
);

router.get(
  '/otp',
  redirectIfAuthed,
  csrfProtection,
  setCsrf,
  must(admin.otpForm, 'admin.otpForm')
);

router.post(
  '/otp',
  redirectIfAuthed,
  csrfProtection,
  setCsrf,
  must(admin.otpVerify, 'admin.otpVerify')
);

// Logout: prefer POST with CSRF; GET kept for safety but without CSRF
router.post('/logout', requireAdmin, csrfProtection, setCsrf, (req, res) => {
  req.session.admin = null;
  req.session.pendingAdmin = null;
  req.session.otp = null;
  req.session.destroy?.(() => {});
  return res.redirect('/admin/login');
});

router.get('/logout', (req, res) => {
  req.session.admin = null;
  req.session.pendingAdmin = null;
  req.session.otp = null;
  req.session.destroy?.(() => {});
  return res.redirect('/admin/login');
});

/* ────────────────────────────────────────────────────────────
   Dashboard
──────────────────────────────────────────────────────────── */
router.get(
  '/',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('dashboard'),
  must((req, res, next) => admin.dashboard(req, res, next), 'admin.dashboard')
);

/* ────────────────────────────────────────────────────────────
   Products
   NOTE (multipart): multer MUST run before csrfProtection
──────────────────────────────────────────────────────────── */
router.get(
  '/products',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('products'),
  async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        'SELECT id, name, slug, image, active, created_at, category, short_desc, description FROM products ORDER BY created_at DESC'
      );
      return res.render('admin/products-list', { title: 'Products', items: rows });
    } catch (e) { return next(e); }
  }
);

router.get(
  '/products/new',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('products'),
  (_req, res) => res.render('admin/products-new', { title: 'Add Product' })
);

router.post(
  '/products/new',
  requireAdmin,
  must(admin.uploadImage?.single?.('image'), 'admin.uploadImage.single(image)'),
  csrfProtection,
  setCsrf,
  withHeader('products'),
  must(admin.productCreate, 'admin.productCreate')
);

router.get(
  '/products/:id/edit',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('products'),
  must(admin.productEditForm, 'admin.productEditForm')
);

router.post(
  '/products/:id/edit',
  requireAdmin,
  must(admin.uploadImage?.single?.('image'), 'admin.uploadImage.single(image)'),
  csrfProtection,
  setCsrf,
  withHeader('products'),
  must(admin.productUpdate, 'admin.productUpdate')
);

router.post(
  '/products/:id/delete',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('products'),
  must(admin.productDelete, 'admin.productDelete')
);

/* ────────────────────────────────────────────────────────────
   Recycle Bin
──────────────────────────────────────────────────────────── */
router.get(
  '/recycle',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('recycle'),
  must(admin.recycleList, 'admin.recycleList')
);

router.post(
  '/recycle/:id/restore',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('recycle'),
  must(admin.recycleRestore, 'admin.recycleRestore')
);

router.post(
  '/recycle/:id/delete',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('recycle'),
  must(admin.recycleDeleteForever, 'admin.recycleDeleteForever')
);

/* ────────────────────────────────────────────────────────────
   Testimonials
──────────────────────────────────────────────────────────── */
router.get(
  '/testimonials',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('testimonials'),
  async (req, res, next) => {
    try {
      const filter = normalizeApprovedFilter(req.query.filter);
      let sql = `
        SELECT id, name, rating, comment AS message, approved, created_at
        FROM testimonials
      `;
      if (filter === 'approved') sql += ' WHERE approved = 1';
      else if (filter === 'pending') sql += ' WHERE approved = 0';
      sql += ' ORDER BY created_at DESC, id DESC LIMIT 200';

      const [rows] = await pool.query(sql);
      return res.render('admin/testimonials-list', { title: 'Testimonials', items: rows || [], filter });
    } catch (e) { return next(e); }
  }
);

router.post(
  '/testimonials/:id/approve',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('testimonials'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Bad id');
      await pool.query('UPDATE testimonials SET approved = 1 WHERE id = ?', [id]);
      const back = normalizeApprovedFilter(req.query.filter);
      return res.redirect(`/admin/testimonials?filter=${encodeURIComponent(back)}`);
    } catch (e) { return next(e); }
  }
);

router.post(
  '/testimonials/:id/unapprove',
  requireAdmin,
  csrfProtection,
  setCsrf,
  withHeader('testimonials'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Bad id');
      await pool.query('UPDATE testimonials SET approved = 0 WHERE id = ?', [id]);
      const back = normalizeApprovedFilter(req.query.filter);
      return res.redirect(`/admin/testimonials?filter=${encodeURIComponent(back)}`);
    } catch (e) { return next(e); }
  }
);

/* ────────────────────────────────────────────────────────────
   Blog
   (keep multer → csrf order on multipart posts)
──────────────────────────────────────────────────────────── */
router.get('/blog',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogList, 'admin.blogList')
);

router.get('/blog/new',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogNewForm, 'admin.blogNewForm')
);

router.post('/blog/new',
  requireAdmin,
  must(admin.uploadBlogImage?.single?.('image'), 'admin.uploadBlogImage.single(image)'),
  csrfProtection,
  setCsrf,
  withHeader('blog'),
  must(admin.blogCreate, 'admin.blogCreate')
);

router.get('/blog/:id/edit',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogEditForm, 'admin.blogEditForm')
);

router.post('/blog/:id/edit',
  requireAdmin,
  must(admin.uploadBlogImage?.single?.('image'), 'admin.uploadBlogImage.single(image)'),
  csrfProtection,
  setCsrf,
  withHeader('blog'),
  must(admin.blogUpdate, 'admin.blogUpdate')
);

router.post('/blog/:id/publish',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogPublish, 'admin.blogPublish')
);

router.post('/blog/:id/unpublish',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogUnpublish, 'admin.blogUnpublish')
);

router.post('/blog/:id/delete',
  requireAdmin, csrfProtection, setCsrf, withHeader('blog'),
  must(admin.blogDelete, 'admin.blogDelete')
);

/* ────────────────────────────────────────────────────────────
   CONTACT MESSAGES (Admin)
──────────────────────────────────────────────────────────── */
router.get('/messages',
  requireAdmin, csrfProtection, setCsrf, withHeader('messages'),
  must(admin.messagesList, 'admin.messagesList')
);

router.get('/messages/:id',
  requireAdmin, csrfProtection, setCsrf, withHeader('messages'),
  must(admin.messageView, 'admin.messageView')
);

router.post('/messages/:id/delete',
  requireAdmin, csrfProtection, setCsrf, withHeader('messages'),
  must(admin.messageDelete, 'admin.messageDelete')
);


module.exports = router;
