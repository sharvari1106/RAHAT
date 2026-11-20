// PostgreSQL connection pool (server-side only).
// Credentials come from DATABASE_URL in .env - never hard-coded.
import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC and BIGINT arrive as strings by default; money values here are small enough for JS numbers
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8 / bigint

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    options: '-c timezone=Asia/Kolkata', // dates in reports follow Indian time
  });
}

// reuse one pool across hot reloads in development
const g = globalThis;
export function getPool() {
  if (!g.__rahatPool) g.__rahatPool = createPool();
  return g.__rahatPool;
}

// node-postgres does not know our custom enum array type need_type[] and would return it as the raw
// string '{rescue,medical}'. Look up its type OID once and parse it like a normal text[] array.
async function registerEnumArrays() {
  if (!g.__rahatTypes) {
    g.__rahatTypes = getPool()
      .query("SELECT oid FROM pg_type WHERE typname = '_need_type'")
      .then(({ rows }) => {
        if (rows[0]) types.setTypeParser(rows[0].oid, types.getTypeParser(1009)); // 1009 = text[]
      })
      .catch((e) => {
        g.__rahatTypes = null;
        throw e;
      });
  }
  return g.__rahatTypes;
}

// Safety net: if an enum array still arrives as text ('{rescue,medical}'), turn it into a JS array.
function fixArrays(result) {
  for (const row of result.rows || []) {
    if (typeof row.needs === 'string') {
      row.needs = row.needs.replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/"/g, '')).filter(Boolean);
    }
  }
  return result;
}

export async function query(text, params) {
  await registerEnumArrays();
  return fixArrays(await getPool().query(text, params));
}

export async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Run fn(client) inside BEGIN ... COMMIT. Any thrown error -> ROLLBACK.
 * Deadlocks (40P01) and serialization failures (40001) are retried automatically.
 */
export async function withTransaction(fn, { isolation = 'READ COMMITTED', retries = 3 } = {}) {
  await registerEnumArrays();
  for (let attempt = 1; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const retryable = err.code === '40P01' || err.code === '40001';
      if (retryable && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
