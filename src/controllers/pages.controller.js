// src/controllers/pages.controller.js
const { pool } = require('../db');

// GET /
exports.home = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT name, comment AS message, rating, created_at
      FROM testimonials
      WHERE approved = 1
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Normalize + clamp ratings
    const base = (rows || []).map(r => ({
      name: r.name || 'Guest',
      message: r.message || '',
      rating: Math.max(1, Math.min(5, Number(r.rating) || 5)),
      created_at: r.created_at || null
    }));

    // Ensure at least 5 cards for the fan layout (duplicate to fill)
    let testimonials = base.slice();
    const origLen = testimonials.length;
    if (origLen > 0 && origLen < 5) {
      let i = 0;
      while (testimonials.length < 5) {
        testimonials.push({ ...testimonials[i % origLen] });
        i++;
      }
    }

    return res.render('home', {
      title: 'Jay Mahalaxmi Ind. Pvt. Ltd',
      testimonials
    });
  } catch (e) {
    return next(e);
  }
};

// GET /about
exports.about = (_req, res) =>
  res.render('about', { title: 'About Us' });
