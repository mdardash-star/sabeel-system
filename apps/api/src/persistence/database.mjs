import pg from 'pg';

const { Pool } = pg;

export function createDatabase({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) return null;

  const sslMode = String(process.env.DATABASE_SSL || '').trim().toLowerCase();
  const ssl = ['true', 'require', 'required'].includes(sslMode)
    ? { rejectUnauthorized: false }
    : undefined;

  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5_000),
    ssl
  });

  return {
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
    close: () => pool.end()
  };
}
