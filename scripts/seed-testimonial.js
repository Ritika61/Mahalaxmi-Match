require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    });

    const values = [
      ['Aarav G.', 'Excellent quality and timely delivery!', 5, 1],
      ['Sita K.', 'Matches light instantly. Very reliable.', 5, 1],
      ['Ramesh P.', 'Good burn time and packaging. Recommended.', 4, 1]
    ];
    await conn.query(
      `INSERT INTO testimonials (name, comment, rating, approved)
       VALUES ?`, [values]
    );

    console.log('Seeded testimonials');
    await conn.end();
  } catch (e) {
    console.error('Seed failed:', e.stack || e.message);
    process.exit(1);
  }
})();
