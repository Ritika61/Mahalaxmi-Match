const { pool } = require('../db');

exports.list = async (req, res, next) => {
  try {
    const pageSize = 9;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const q = (req.query.q || '').trim();
    const tag = (req.query.tag || '').trim();
    const where = [];
    const params = [];

    if (q) { where.push('(title LIKE ? OR excerpt LIKE ? OR html LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    if (tag) { where.push('tag_slug = ?'); params.push(tag); }
    where.push('(published_at IS NOT NULL)'); // only published

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM blog_posts ${whereSql}`, params);
    const totalPages = Math.max(1, Math.ceil(cnt / pageSize));
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT id, slug, title, excerpt, image, tag_slug, tag_name, published_at, created_at
         FROM blog_posts
        ${whereSql}
        ORDER BY published_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      params.concat([pageSize, offset])
    );

    const [featuredRow] = await pool.query(
      `SELECT id, slug, title, excerpt, image, tag_name, published_at, created_at
         FROM blog_posts
        WHERE published_at IS NOT NULL
        ORDER BY published_at DESC, id DESC
        LIMIT 1`
    );

    const [recent] = await pool.query(
      `SELECT slug, title, published_at, created_at
         FROM blog_posts
        WHERE published_at IS NOT NULL
        ORDER BY published_at DESC, id DESC
        LIMIT 6`
    );

    // tags for filter (top 12 by latest)
    const [tags] = await pool.query(
      `SELECT tag_slug AS slug, tag_name AS name
         FROM blog_posts
        WHERE tag_slug IS NOT NULL AND tag_slug != ''
        GROUP BY tag_slug, tag_name
        ORDER BY MAX(published_at) DESC
        LIMIT 12`
    );

    res.render('blog/index', {
      title: 'Blog',
      featured: featuredRow?.[0] || rows?.[0] || null,
      posts: rows,
      recent,
      tags,
      q, tag,
      page, totalPages
    });
  } catch (e) { next(e); }
};

exports.post = async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [[post]] = await pool.query(
      `SELECT * FROM blog_posts WHERE slug=? AND published_at IS NOT NULL LIMIT 1`, [slug]
    );
    if (!post) return res.status(404).send('Article not found');

    const [more] = await pool.query(
      `SELECT slug, title, excerpt, image, published_at, created_at
         FROM blog_posts
        WHERE published_at IS NOT NULL AND slug <> ?
        ORDER BY published_at DESC, id DESC
        LIMIT 3`,
      [slug]
    );

    const canonical = `${req.protocol}://${req.get('host')}/blog/${slug}`;

    res.render('blog/post', { post, more, canonical });
  } catch (e) { next(e); }
};
