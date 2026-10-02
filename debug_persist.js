require('dotenv').config();
const db = require('./src/db/index');
const tables = ['risk_assessments', 'risk_reasons', 'decisions', 'shipments'];
Promise.all(tables.map(t => 
  db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${t}' ORDER BY ordinal_position`)
)).then(results => {
  tables.forEach((t, i) => {
    console.log(`\n=== ${t} ===`);
    results[i].rows.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));
  });
  db.pool.end();
}).catch(e => { console.error(e.message); db.pool.end(); });
