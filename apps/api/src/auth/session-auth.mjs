import { createHash } from 'node:crypto';

export async function authenticateBearer(db, authorization, now = new Date()) {
  if (!db?.query) throw new Error('Authentication database unavailable');
  const token = parseBearerToken(authorization);
  if (!token) return null;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.role
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > $2
       AND s.revoked_at IS NULL
       AND u.is_active = true
     LIMIT 1`,
    [tokenHash, now.toISOString()]
  );
  return rows[0] || null;
}

export function parseBearerToken(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]{32,512})$/);
  return match?.[1] || null;
}
