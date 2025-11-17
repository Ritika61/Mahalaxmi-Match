const express = require('express');
const router = express.Router();
const pages = require('../controllers/pages.controller');

// public pages
router.get('/', pages.home);
router.get('/about', pages.about);

// keep /contact owned by the dedicated contact router
router.get('/contact', (_req, res) => res.redirect('/contact/step/profile'));

module.exports = router;  // <-- IMPORTANT
