// scripts/seed-admin-mysql.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

(async () => {
  try {
    const email = process.argv[2];
    const plain = process.argv[3];
    if (!email || !plain) {
      console.error('Usage: node scripts/seed-admin-mysql.js "email" "password"');
      process.exit(1);
    }

    // connect directly using .env (no external pool)
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      multipleStatements: true,
    });

    // ensure table exists (matches your controllers which use `admin_users`)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        pass_hash VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        failed_attempts INT NOT NULL DEFAULT 0,
        lock_until DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const pass_hash = await bcrypt.hash(plain, 12);

    // upsert user
    await conn.query(
      `INSERT INTO admin_users (email, pass_hash, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE pass_hash = VALUES(pass_hash), is_active = 1`,
      [email, pass_hash]
    );

    await conn.end();
    console.log(`Seeded admin: ${email}`);
    console.log('You can now log in at /admin/login');
  } catch (err) {
    console.error('Failed to seed admin:', err.message);
    process.exit(1);
  }
})();
