// Loads the 3-day flood simulation (sql/seed.sql) and, if MongoDB is configured,
// some field reports and activity-log entries.
//   npm run db:seed      (run npm run db:setup first)
import fs from 'node:fs';
import pg from 'pg';
import { getMongo } from '../lib/mongo.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=Asia/Kolkata' });
client.on('notice', (n) => n.message.startsWith('Seeded') && console.log(n.message));
await client.connect();
try {
  const { rows } = await client.query('SELECT COUNT(*)::INT AS n FROM incidents');
  if (rows[0].n > 0) {
    throw new Error('The database already has data. Run "npm run db:setup" first (it resets everything).');
  }
  console.log('Running sql/seed.sql (simulating three days of a flood response)...');
  await client.query(fs.readFileSync('sql/seed.sql', 'utf8'));

  const db = await getMongo();
  if (!db) {
    console.log('MongoDB not configured - skipping field reports (the app works without them).');
  } else {
    const inc = (await client.query("SELECT incident_id, started_at FROM incidents WHERE code = 'INC-2026-001'")).rows[0];
    const t0 = new Date(inc.started_at).getTime();
    const hour = 3600_000;
    const at = (h) => new Date(t0 + h * hour);
    const p = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });
    const by = { userId: 2, name: 'Anita (Coordinator)', role: 'coordinator', unit: null };
    const docs = [
      { type: 'water_level', location: p(12.3866, 75.531), details: { waterLevelM: 4.2, rising: true, gauge: 'Triveni Sangama' }, note: 'Kaveri over danger mark', reportedAt: at(2) },
      { type: 'water_level', location: p(12.3866, 75.531), details: { waterLevelM: 5.1, rising: true, gauge: 'Triveni Sangama' }, reportedAt: at(14) },
      { type: 'water_level', location: p(12.3866, 75.531), details: { waterLevelM: 4.6, rising: false, gauge: 'Triveni Sangama' }, note: 'starting to recede', reportedAt: at(50) },
      { type: 'water_level', location: p(12.4573, 75.9631), details: { waterLevelM: 2.8, rising: true, gauge: 'Kushalnagar bridge' }, reportedAt: at(20) },
      { type: 'road_blocked', location: p(12.37, 75.66), details: { roadName: 'Madikeri - Bhagamandala road', cause: 'landslide', passableBy: 'none' }, reportedAt: at(6) },
      { type: 'road_blocked', location: p(12.3, 75.72), details: { roadName: 'Napoklu - Murnad road', cause: 'flooding', passableBy: 'boat' }, reportedAt: at(11) },
      { type: 'damage', location: p(12.3087, 75.6915), details: { housesDamaged: 46, housesDestroyed: 9, cattleLost: 30 }, note: 'Napoklu low-lying wards', reportedAt: at(30) },
      { type: 'damage', location: p(12.597, 75.8497), details: { housesDamaged: 18, housesDestroyed: 2 }, reportedAt: at(40) },
      { type: 'power_telecom', location: p(12.1975, 75.804), details: { power: false, mobile: true, households: 1200 }, reportedAt: at(25) },
    ].map((d) => ({ incidentId: inc.incident_id, reportedBy: by, note: null, ...d }));
    await db.collection('field_reports').deleteMany({ incidentId: inc.incident_id });
    await db.collection('field_reports').insertMany(docs);
    console.log(`MongoDB: ${docs.length} field reports inserted (2dsphere + wildcard indexes created).`);
  }
  console.log('\nDone. Next: npm run db:embed   (multilingual embeddings for duplicate detection and missing-person matching)');
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
  process.exit(process.exitCode || 0); // MongoDB client keeps the process alive otherwise
}
