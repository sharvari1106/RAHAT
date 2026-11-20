// Loads ONLY the MongoDB field reports. Does NOT touch PostgreSQL data (safe to run any time).
import pg from 'pg';
import { getMongo } from '../lib/mongo.js';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is empty in .env - paste your MongoDB Atlas connection string first.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const db = await getMongo();
  if (!db) throw new Error('Could not connect to MongoDB. Check the connection string, password and Atlas Network Access.');
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
  console.log('Indexes on field_reports:', (await db.collection('field_reports').indexes()).map((i) => i.name).join(', '));
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
  process.exit(process.exitCode || 0);
}