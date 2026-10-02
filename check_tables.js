const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
  .then(r => { console.log('TABLES:', r.rows.map(x=>x.table_name).join(', ')); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
