// Computes 384-d multilingual embeddings for SOS descriptions, camp residents and missing-person
// reports, and stores them in pgvector columns. Safe to re-run (only fills rows without one).
//   npm run db:embed
// First run downloads the multilingual MiniLM model (~120 MB); later runs use the cache.
import pg from 'pg';
import { embed, personText, sosText, toPgVector } from '../lib/embeddings.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function fill(table, key, select, toText) {
  const { rows } = await client.query(`SELECT ${key}, ${select} FROM ${table} WHERE embedding IS NULL ORDER BY ${key}`);
  let done = 0;
  for (let i = 0; i < rows.length; i += 32) {
    const batch = rows.slice(i, i + 32);
    const vecs = await embed(batch.map(toText));
    if (!vecs) return -1;
    await client.query('BEGIN');
    for (let j = 0; j < batch.length; j++) {
      await client.query(`UPDATE ${table} SET embedding = $1::vector WHERE ${key} = $2`, [toPgVector(vecs[j]), batch[j][key]]);
    }
    await client.query('COMMIT');
    done += batch.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  console.log(`\r  ${table}: ${done} embedded      `);
  return done;
}

try {
  console.log('Embedding (the first run downloads the model, please wait)...');
  const t0 = Date.now();
  // the SOS update only sets the embedding column; the immutable-report trigger allows that
  const a = await fill('sos_requests', 'sos_id', 'description, landmark', sosText);
  if (a < 0) {
    console.log('The embedding model could not be loaded. Semantic matching stays off; everything else works.');
  } else {
    await fill('people', 'person_id', 'full_name, age, gender, home_village, marks', personText);
    await fill('missing_reports', 'report_id', 'full_name, age, gender, home_village, description, last_seen_place', personText);
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

    console.log('Demo 1 - the same emergency in three languages (cosine similarity to SOS-000002):');
    const { rows } = await client.query(
      `SELECT b.ticket, ROUND((1 - (a.embedding <=> b.embedding))::NUMERIC, 3) AS sim, left(b.description, 60) AS text
         FROM sos_requests a, sos_requests b
        WHERE a.ticket = 'SOS-000002' AND b.sos_id <> a.sos_id
        ORDER BY a.embedding <=> b.embedding LIMIT 5`
    );
    rows.forEach((r) => console.log(`  ${r.ticket}  ${r.sim}  ${r.text}`));

    console.log('\nDemo 2 - best camp match for each missing-person report (name + description + age + gender):');
    const m = await client.query(
      `SELECT r.ticket, r.full_name, b.full_name AS candidate, b.camp_name, b.text_similarity, b.score
         FROM missing_reports r, LATERAL fn_match_missing(r.report_id, 1) b ORDER BY r.report_id`
    );
    m.rows.forEach((r) => console.log(`  ${r.ticket} ${r.full_name.padEnd(16)} -> ${r.candidate} (${r.camp_name || 'not in camp'}) text ${r.text_similarity} score ${r.score}`));
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
