/**
 * seed.js — Seeds Neon DB with demo shipper data from mockData.js
 * Creates shippers, accounts, devices, payments, shipper_profiles
 * so GET /api/accounts/:id returns real DB data from day one.
 * Usage: node seed.js
 */
require('dotenv').config();
const db = require('./src/db/index');
const repo = require('./src/db/repository');

const SHIPPERS = [
  {
    external_ref: 'S1001',
    company_name: 'Chennai Export Pvt Ltd',
    avg_daily: 2.4, avg_weight: 8.6, std_weight: 3.2,
    known_devices: ['dev-d12-fingerprint', 'dev-d31-fingerprint'],
    known_payments: ['pay-p03-token', 'pay-p07-token'],
    total_shipments: 842,
    destinations: ['Bangalore', 'Hyderabad', 'Mumbai'],
    origins: ['Chennai'],
    services: { GROUND: 0.6, EXPRESS: 0.4 },
    last_password_change: '2026-09-28T10:30:00Z',
    last_profile_update: '2026-09-30T18:15:00Z',
    account_type: 'BUSINESS',
    status: 'ACTIVE',
  },
  {
    external_ref: 'S2002',
    company_name: 'Mumbai Small Shipper',
    avg_daily: 0.3, avg_weight: 2.1, std_weight: 0.8,
    known_devices: ['dev-d55-fingerprint'],
    known_payments: ['pay-p11-token'],
    total_shipments: 12,
    destinations: ['Pune', 'Nashik'],
    origins: ['Mumbai'],
    services: { GROUND: 1.0 },
    last_password_change: '2026-08-15T12:00:00Z',
    last_profile_update: '2026-08-15T12:00:00Z',
    account_type: 'INDIVIDUAL',
    status: 'ACTIVE',
  },
  {
    external_ref: 'S3003',
    company_name: 'Delhi Enterprise Corp',
    avg_daily: 28.3, avg_weight: 12.4, std_weight: 5.1,
    known_devices: ['dev-e01-fingerprint', 'dev-e02-fingerprint', 'dev-e03-fingerprint'],
    known_payments: ['pay-q01-token', 'pay-q02-token'],
    total_shipments: 8420,
    destinations: ['Mumbai', 'Chennai', 'Bangalore', 'Hyderabad', 'Kolkata'],
    origins: ['Delhi', 'Noida'],
    services: { GROUND: 0.3, EXPRESS: 0.5, FREIGHT: 0.2 },
    last_password_change: '2026-08-01T09:00:00Z',
    last_profile_update: '2026-09-15T14:00:00Z',
    account_type: 'ENTERPRISE',
    status: 'ACTIVE',
  },
  {
    external_ref: 'S4004',
    company_name: 'Suspicious Shipper Ind',
    avg_daily: 1.2, avg_weight: 3.5, std_weight: 1.0,
    known_devices: ['dev-x99-fingerprint'],
    known_payments: ['pay-sus-token'],
    total_shipments: 38,
    destinations: ['Hyderabad'],
    origins: ['Hyderabad'],
    services: { EXPRESS: 0.9, GROUND: 0.1 },
    last_password_change: '2026-09-25T00:30:00Z',
    last_profile_update: '2026-09-25T00:31:00Z',
    account_type: 'BUSINESS',
    status: 'UNDER_INVESTIGATION',
  },
];

async function seed() {
  console.log('🌱 Seeding Neon with demo shipper data...\n');

  for (const s of SHIPPERS) {
    try {
      // Shipper
      const shipperId = await repo.upsertShipper({
        external_ref: s.external_ref,
        company_name: s.company_name,
        country: 'IN',
      });

      // Account
      const accountId = await repo.upsertAccount({
        shipper_id: shipperId,
        account_number: s.external_ref,
        account_type: s.account_type,
        status: s.status,
        last_profile_change_at: s.last_profile_update,
        last_password_change_at: s.last_password_change,
      });

      // Known devices
      for (const fp of s.known_devices) {
        const dev = await repo.upsertDevice({ fingerprint_hash: fp, device_type: 'desktop' });
        await repo.linkDeviceToAccount(accountId, dev.device_id);
      }

      // Known payments
      for (const tok of s.known_payments) {
        const pay = await repo.upsertPayment({ payment_token: tok, method_type: 'CREDIT_CARD' });
        await repo.linkPaymentToAccount(accountId, pay.payment_id, true);
      }

      // Shipper profile
      await db.query(
        `INSERT INTO shipper_profiles
           (account_id, total_shipments, avg_daily_volume, avg_weight_kg, std_weight_kg,
            common_origins, common_destinations, service_mix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (account_id) DO UPDATE
           SET total_shipments = EXCLUDED.total_shipments,
               avg_daily_volume = EXCLUDED.avg_daily_volume,
               avg_weight_kg = EXCLUDED.avg_weight_kg,
               std_weight_kg = EXCLUDED.std_weight_kg,
               common_origins = EXCLUDED.common_origins,
               common_destinations = EXCLUDED.common_destinations,
               service_mix = EXCLUDED.service_mix,
               updated_at = now()`,
        [accountId, s.total_shipments, s.avg_daily, s.avg_weight, s.std_weight,
         JSON.stringify(s.origins), JSON.stringify(s.destinations), JSON.stringify(s.services)]
      );

      console.log(`  ✅ ${s.external_ref} (${s.company_name}) — ${s.total_shipments} shipments seeded`);
    } catch (e) {
      console.error(`  ❌ ${s.external_ref}: ${e.message}`);
    }
  }

  // Insert a demo staff analyst for Backend B
  await db.query(`
    INSERT INTO staff_users (email, full_name, role)
    VALUES ('demo-analyst@fraudshield.dev', 'Demo Analyst', 'ANALYST')
    ON CONFLICT (email) DO NOTHING
  `).catch(() => {});
  console.log('\n  ✅ Demo analyst staff user created');

  console.log('\n✅ Seed complete!');
  await db.pool.end();
}

seed().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
