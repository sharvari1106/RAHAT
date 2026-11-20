// MongoDB: field situation reports (flexible, schema-less documents) and the activity log.
// The app keeps working if MongoDB is not configured or is down - those features just switch off.
import { MongoClient } from 'mongodb';

const g = globalThis;

export async function ensureIndexes(db) {
  const reports = db.collection('field_reports');
  // most queries: "latest reports for this incident", "reports of this type"
  await reports.createIndex({ incidentId: 1, reportedAt: -1 });
  await reports.createIndex({ incidentId: 1, type: 1, reportedAt: -1 });
  // 2dsphere index: "reports within 2 km of this point" ($near / $geoWithin)
  await reports.createIndex({ location: '2dsphere' });
  // wildcard index: every type has different fields (waterLevelM, roadName, housesDamaged...)
  await reports.createIndex({ 'details.$**': 1 });

  const logs = db.collection('activity_logs');
  await logs.createIndex({ at: -1 });
  await logs.createIndex({ action: 1, at: -1 });
  // TTL index: MongoDB deletes log documents automatically after 180 days
  await logs.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180, name: 'ttl_180d' });
}

export async function getMongo() {
  if (!process.env.MONGODB_URI) return null;
  // after a failed connect, don't make every request wait for the timeout again for 30 s
  if (g.__rahatMongoDownUntil && Date.now() < g.__rahatMongoDownUntil) return null;
  try {
    if (!g.__rahatMongo) {
      g.__rahatMongo = MongoClient.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2500,
      }).then(async (client) => {
        await ensureIndexes(client.db(process.env.MONGODB_DB || 'rahat'));
        return client;
      });
    }
    const client = await g.__rahatMongo;
    return client.db(process.env.MONGODB_DB || 'rahat');
  } catch (e) {
    g.__rahatMongo = null;
    g.__rahatMongoDownUntil = Date.now() + 30_000;
    console.warn('[mongo] unavailable, retrying in 30s:', e.message);
    return null;
  }
}

/** Fire-and-forget audit log. Never breaks the request that called it. */
export async function logActivity({ userId, role, action, entity, entityId, meta = {}, at }) {
  try {
    const db = await getMongo();
    if (!db) return;
    await db.collection('activity_logs').insertOne({
      userId,
      role,
      action,
      entity,
      entityId,
      meta,
      at: at ? new Date(at) : new Date(),
    });
  } catch (e) {
    console.warn('[mongo] log failed:', e.message);
  }
}

/** Field report types and the extra fields each one carries (documented in the report). */
export const FIELD_REPORT_TYPES = {
  water_level: { label: 'Water level', fields: { waterLevelM: 'number', rising: 'boolean', gauge: 'string' } },
  road_blocked: { label: 'Road blocked', fields: { roadName: 'string', cause: 'string', passableBy: 'string' } },
  damage: { label: 'Damage assessment', fields: { housesDamaged: 'number', housesDestroyed: 'number', cattleLost: 'number' } },
  power_telecom: { label: 'Power / phone outage', fields: { power: 'boolean', mobile: 'boolean', households: 'number' } },
  other: { label: 'Other', fields: {} },
};
