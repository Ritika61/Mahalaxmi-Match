// src/models/products.js
const { pool } = require('../db');

// List all active products for the grid page
exports.listActive = async () => {
  const [rows] = await pool.query(
    'SELECT id,name,slug,category,short_desc,image FROM products WHERE active=1 ORDER BY id ASC'
  );
  return rows;
};

// Get one product by slug for the detail page
exports.getBySlug = async (slug) => {
  const [rows] = await pool.query(
    'SELECT * FROM products WHERE slug=? AND active=1 LIMIT 1',
    [slug]
  );
  return rows[0] || null;
};
