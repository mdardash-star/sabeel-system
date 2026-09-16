import pg from 'pg';

const { Pool } = pg;

function connectionForExplicitSsl(connectionString, sslEnabled) {
  if (!sslEnabled) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function createDatabase({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) return null;

  const sslMode = String(process.env.DATABASE_SSL || '').trim().toLowerCase();
  const sslEnabled = ['true', 'require', 'required'].includes(sslMode);
  const ssl = sslEnabled ? { rejectUnauthorized: false } : undefined;
  const normalizedConnectionString = connectionForExplicitSsl(connectionString, sslEnabled);

  const pool = new Pool({
    connectionString: normalizedConnectionString,
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
