import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { routeRequest } from './http/router.mjs';
import { routePersistentRequest } from './http/persistent-router.mjs';
import { createDatabase } from './persistence/database.mjs';

export function createRequestHandler({ db = null } = {}) {
  return async function handleRequest(req, res) {
    try {
      const requestUrl = new URL(req.url, 'http://subil.local');
      const body = await readJson(req);
      const role = req.headers['x-subil-role'] || 'anonymous';
      const userId = req.headers['x-subil-user-id'] || null;
      const context = {
        userId,
        from: requestUrl.searchParams.get('from') || undefined,
        to: requestUrl.searchParams.get('to') || undefined,
        limit: requestUrl.searchParams.get('limit') || undefined,
        offset: requestUrl.searchParams.get('offset') || undefined,
        jobs: []
      };

      const result = isPersistentRoute(req.method, requestUrl.pathname)
        ? await routePersistentRequest({ method: req.method, url: requestUrl.pathname, role, context, db })
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

export function createApiServer({ db = createDatabase() } = {}) {
  return http.createServer(createRequestHandler({ db }));
}

function isPersistentRoute(method, pathname) {
  return method === 'GET' && (
    /^\/api\/v1\/technicians\/me\/jobs(?:\/[^/]+)?$/.test(pathname) ||
    pathname === '/api/v1/technicians/me/wallet'
  );
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
