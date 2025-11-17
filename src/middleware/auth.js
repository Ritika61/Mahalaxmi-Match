// Simple gate for admin routes
exports.requireAdmin = (req, res, next) => {
  if (req.session && req.session.admin) {
    res.locals.admin = req.session.admin;  // handy in EJS
    return next();
  }
  // remember where to return after login
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
};
