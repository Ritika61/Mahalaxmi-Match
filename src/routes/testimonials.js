// src/routes/testimonials.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/testimonials.controller');

const router = express.Router();

// Per-IP limiter for submits (15 min window, max 8)
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8
});

// If global CSRF is mounted in server.js, this will pick up the token;
// if not, it will silently no-op.
function exposeCsrf(req, res, next) {
  try {
    if (typeof res.locals.csrfToken !== 'function' && req.csrfToken) {
      res.locals.csrfToken = req.csrfToken();
    }
  } catch {
    // ignore — CSRF not mounted for this request
  }
  next();
}


router.get('/', exposeCsrf, controller.list);
router.post('/', submitLimiter, controller.create);

module.exports = router;
