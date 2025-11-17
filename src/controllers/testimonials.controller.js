// src/controllers/testimonials.controller.js
const Joi = require('joi');
const xss = require('xss');
const { pool } = require('../db');

/* ---------------- Validation ---------------- */
const submitSchema = Joi.object({
  name: Joi.string().max(120).required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  message: Joi.string().max(2000).required()
});

/* ---------------- Helpers ---------------- */
const clean = (v) => xss(String(v || '').trim());
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, (n | 0) || 0));

/* =========================================================
   GET /testimonials → form + latest approved (paginated)
========================================================= */
exports.list = async (req, res, next) => {
  try {
    const PAGE_SIZE = 12;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    // Count approved rows for pagination
    const [[countRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM testimonials WHERE approved = 1'
    );
    const total = Number(countRow?.cnt || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // Page of approved testimonials
    const [rows] = await pool.query(
      `
        SELECT
          id,
          name,
          rating,
          comment   AS message,
          approved,
          created_at
        FROM testimonials
        WHERE approved = 1
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      [PAGE_SIZE, offset]
    );

    // flash messages from last POST (if any)
    const flash = req.session._flash || {};
    delete req.session._flash;

    res.render('testimonials/index', {
      title: 'Testimonials',
      items: rows || [],
      error: flash.error || null,
      success: flash.success || null,
      data: flash.data || null,
      page,
      totalPages
      // csrfToken should be set in res.locals if your router attaches it
    });
  } catch (e) {
    next(e);
  }
};

/* =========================================================
   POST /testimonials → submit (stored as pending)
   - Validates & sanitizes
   - Inserts with approved = 0
   - Redirects back with flash message
========================================================= */
exports.create = async (req, res, next) => {
  try {
    const { value, error } = submitSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      req.session._flash = {
        error: error.details.map(d => d.message).join('<br>'),
        data: {
          name: req.body?.name || '',
          rating: req.body?.rating || '',
          message: req.body?.message || ''
        }
      };
      return req.session.save(() => res.redirect('/testimonials'));
    }

    // sanitize + normalize
    const payload = {
      name: clean(value.name),
      rating: clamp(+value.rating, 1, 5),
      message: clean(value.message)
    };

    // Insert pending (approved=0). Admin will later set approved=1.
    await pool.query(
      `
        INSERT INTO testimonials (name, comment, rating, approved)
        VALUES (?, ?, ?, 0)
      `,
      [payload.name, payload.message, payload.rating]
    );

    req.session._flash = {
      success: 'Thanks for your feedback! It will appear once approved.'
    };
    return req.session.save(() => res.redirect('/testimonials'));
  } catch (e) {
    // common size error
    if (e && e.code === 'ER_DATA_TOO_LONG') {
      req.session._flash = {
        error: 'One of the fields is too long. Please shorten and try again.',
        data: {
          name: req.body?.name || '',
          rating: req.body?.rating || '',
          message: req.body?.message || ''
        }
      };
      return req.session.save(() => res.redirect('/testimonials'));
    }
    next(e);
  }
};
