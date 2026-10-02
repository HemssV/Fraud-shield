require('dotenv').config();
const db = require('./src/db/index');
Promise.all([
  db.query('SELECT COUNT(*) AS c FROM shipments'),
  db.query('SELECT COUNT(*) AS c FROM risk_assessments'),
  db.query('SELECT COUNT(*) AS c FROM decisions'),
  db.query('SELECT COUNT(*) AS c FROM fraud_cases'),
  db.query('SELECT COUNT(*) AS c FROM entity_links'),
  db.query('SELECT COUNT(*) AS c FROM audit_log'),
  db.query('SELECT ra.risk_score, ra.risk_level, d.action FROM risk_assessments ra JOIN decisions d ON d.assessment_id = ra.assessment_id ORDER BY ra.assessed_at DESC LIMIT 3'),
]).then(([s,ra,dec,fc,el,al,latest]) => {
  console.log('shipments:        ', s.rows[0].c);
  console.log('risk_assessments: ', ra.rows[0].c);
  console.log('decisions:        ', dec.rows[0].c);
  console.log('fraud_cases:      ', fc.rows[0].c);
  console.log('entity_links:     ', el.rows[0].c);
  console.log('audit_log:        ', al.rows[0].c);
  console.log('Latest 3 assessments:');
  latest.rows.forEach(r => console.log(' ', JSON.stringify(r)));
  db.pool.end();
}).catch(e => { console.error(e.message); db.pool.end(); });
