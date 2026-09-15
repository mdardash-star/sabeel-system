import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { routeRequest } from './http/router.mjs';
import { routePersistentRequest } from './http/persistent-router.mjs';
import { createDatabase } from './persistence/database.mjs';
import { authenticateBearer } from './auth/session-auth.mjs';
import { routeAuthRequest } from './http/auth-router.mjs';
import { createOtpSender } from './integrations/otp-sender.mjs';

export function createRequestHandler({ db = null, auth = {}, corsOrigins = [] } = {}) {
  return async function handleRequest(req, res) {
    try {
      const corsAllowed = applyCors(req, res, corsOrigins);
      if (!corsAllowed) return sendJson(res, 403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204); return res.end();
      }
      const requestUrl = new URL(req.url, 'http://subil.local');
      const body = await readJson(req);
      const authRoute = isAuthRoute(req.method, requestUrl.pathname);
      if (authRoute) {
        const result = await routeAuthRequest({
          method: req.method,
          url: requestUrl.pathname,
          body,
          authorization: req.headers.authorization,
          db,
          auth
        });
        return sendJson(res, result.status, result.data);
      }

      const persistent = isPersistentRoute(req.method, requestUrl.pathname);
      let role = req.headers['x-subil-role'] || 'anonymous';
      let userId = req.headers['x-subil-user-id'] || null;
      if (persistent) {
        const session = await authenticateBearer(db, req.headers.authorization);
        if (!session) return sendJson(res, 401, { error: 'invalid_or_expired_session' });
        role = session.role;
        userId = session.user_id;
      }
      const context = {
        userId,
        from: requestUrl.searchParams.get('from') || undefined,
        to: requestUrl.searchParams.get('to') || undefined,
        limit: requestUrl.searchParams.get('limit') || undefined,
        offset: requestUrl.searchParams.get('offset') || undefined,
        query: requestUrl.searchParams.get('q') || undefined,
        jobs: []
      };

      const result = persistent
        ? await routePersistentRequest({ method: req.method, url: requestUrl.pathname, role, body, context, db })
        : routeRequest({ method: req.method, url: requestUrl.pathname, role, body, context });

      sendJson(res, result.status, result.data);
    } catch (error) {
      const isBadRequest = error.message === 'invalid_json' || error.message === 'payload_too_large';
      sendJson(res, isBadRequest ? 400 : 503, {
        error: isBadRequest ? error.message : 'service_unavailable'
      });
    }
  };
}

export function createApiServer({ db = createDatabase(), auth = {}, corsOrigins = parseCorsOrigins(process.env.SUBIL_ADMIN_ORIGINS) } = {}) {
  const runtimeAuth = {
    hashSecret: process.env.OTP_HASH_SECRET,
    sendOtp: createOtpSender(),
    ...auth
  };
  return http.createServer(createRequestHandler({ db, auth: runtimeAuth, corsOrigins }));
}

function parseCorsOrigins(value) {
  return String(value || '').split(',').map(origin => origin.trim()).filter(Boolean);
}

function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.includes(origin)) return false;
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  res.setHeader('access-control-max-age', '600');
  return true;
}

function isAuthRoute(method, pathname) {
  if (method === 'GET') return pathname === '/api/v1/me';
  return method === 'POST' && [
    '/api/v1/auth/otp/request',
    '/api/v1/auth/otp/verify',
    '/api/v1/auth/logout'
  ].includes(pathname);
}

function isPersistentRoute(method, pathname) {
  if (method === 'GET') {
    return /^\/api\/v1\/customers(?:\/[^/]+)?(?:\/(?:timeline|addresses|assets|orders|jobs))?$/.test(pathname) ||
      /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+\/history$/.test(pathname) ||
      /^\/api\/v1\/technicians\/me\/jobs(?:\/[^/]+)?$/.test(pathname) ||
      pathname === '/api/v1/technicians/me/wallet';
  }
  if (method === 'POST') {
    return pathname === '/api/v1/customers' || /^\/api\/v1\/customers\/[^/]+\/(?:addresses|assets)$/.test(pathname) ||
      /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+\/maintenance$/.test(pathname) ||
      /^\/api\/v1\/technicians\/me\/jobs\/[^/]+\/complete$/.test(pathname) ||
      /^\/api\/v1\/settlements\/[^/]+\/approve$/.test(pathname);
  }
  return method === 'PATCH' && (/^\/api\/v1\/customers\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/technicians\/me\/jobs\/[^/]+\/status$/.test(pathname));
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve({});
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('payload_too_large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  const db = createDatabase();
  const server = createApiServer({ db });

  server.listen(port, () => {
    console.log(`SUBIL API listening on ${port}`);
  });

  const shutdown = () => server.close(() => {
    Promise.resolve(db?.close?.()).finally(() => process.exit(0));
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
