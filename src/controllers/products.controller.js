// src/controllers/products.controller.js
const { pool } = require('../db');

// GET /products
async function list(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, slug, short_desc, image
       FROM products
       WHERE active = 1
       ORDER BY created_at DESC`
    );
    res.render('products/index', {
      title: 'Products',
      items: rows
    });
  } catch (e) { next(e); }
}

// GET /products/:slug
async function detail(req, res, next) {
  try {
    const slug = req.params.slug;
    const [rows] = await pool.query(
      `SELECT *
         FROM products
        WHERE slug = ? AND active = 1
        LIMIT 1`,
      [slug]
    );
    const item = rows[0];
    if (!item) {
      return res.status(404).render('products/not-found', { title: 'Product not found' });
    }
    res.render('products/detail', {
      title: item.name,
      item
    });
  } catch (e) { next(e); }
}

module.exports = { list, detail };
