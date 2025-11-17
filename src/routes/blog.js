const router = require('express').Router();
const blog = require('../controllers/blog.controller');

router.get('/', blog.list);
router.get('/:slug', blog.post);

module.exports = router;
