require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

async function main() {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error('Set INITIAL_ADMIN_PASSWORD (at least 12 characters) in your environment before running setup.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare(`INSERT INTO admin (id, password_hash, password_changed_at) VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash, password_changed_at=CURRENT_TIMESTAMP`).run(hash);
  console.log('Admin credential saved as a bcrypt hash. Remove INITIAL_ADMIN_PASSWORD from your environment now.');
  db.close();
}
main().catch(err => { console.error('Admin setup failed.'); process.exit(1); });
