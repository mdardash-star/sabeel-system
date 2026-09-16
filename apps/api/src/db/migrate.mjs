import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../db/migrations');

function stripOuterTransaction(sql) {
  return String(sql)
    .replace(/^\s*BEGIN\s*;?/i, '')
    .replace(/COMMIT\s*;?\s*$/i, '')
    .trim();
}

export async function migrate({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1
  });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("SELECT pg_advisory_lock(hashtext('subil-schema-migrations'))");
    try {
      const names = (await fs.readdir(migrationsDir))
        .filter(name => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const { rows } = await client.query('SELECT filename FROM schema_migrations');
      const applied = new Set(rows.map(row => row.filename));
      let count = 0;
      for (const name of names) {
        if (applied.has(name)) continue;
        const sql = stripOuterTransaction(await fs.readFile(path.join(migrationsDir, name), 'utf8'));
        await client.query('BEGIN');
        try {
          if (sql) await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [name]);
          await client.query('COMMIT');
          count += 1;
          console.log(`Applied migration ${name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${name} failed: ${error.message}`);
        }
      }
      return { applied: count, total: names.length };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('subil-schema-migrations'))");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
