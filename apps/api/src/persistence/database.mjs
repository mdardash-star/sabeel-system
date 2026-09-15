import pg from 'pg';

const { Pool } = pg;

export function createDatabase({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5_000),
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined
  });

  return {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end()
  };
}
