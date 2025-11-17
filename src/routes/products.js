// src/routes/products.js
const express = require('express');
const router = express.Router();
const products = require('../controllers/products.controller');

router.get('/', products.list);
router.get('/:slug', products.detail);

module.exports = router; // <-- REQUIRED
