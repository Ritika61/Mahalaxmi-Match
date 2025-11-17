// scripts/db-setup.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  try {
    // <-- point to sql/schema.sql
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');

    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      multipleStatements: true,
    });

    if (process.env.MYSQL_DATABASE) {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${process.env.MYSQL_DATABASE}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    }

    await conn.query(sql);
    await conn.end();
    console.log('schema.sql applied successfully');
    process.exit(0);
  } catch (e) {
    console.error('Failed to apply schema.sql:', e.message);
    process.exit(1);
  }
})();
