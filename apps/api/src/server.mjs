import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { routeRequest } from './http/router.mjs';
import { routePersistentRequest } from './http/persistent-router.mjs';
import { routeTenantReadRequest } from './http/tenant-read-router.mjs';
import { routeUserAdminRequest } from './http/user-admin-router.mjs';
import { createDatabase } from './persistence/database.mjs';
import { authenticateBearer } from './auth/session-auth.mjs';
import { tenantContext } from './auth/tenant-context.mjs';
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
      let contextTenant = {};
      if (persistent) {
        const session = await authenticateBearer(db, req.headers.authorization);
        if (!session) return sendJson(res, 401, { error: 'invalid_or_expired_session' });
        role = session.role;
        userId = session.user_id;
        contextTenant = tenantContext(session);
      }
      const context = {
        userId,
        ...contextTenant,
        from: requestUrl.searchParams.get('from') || undefined,
        to: requestUrl.searchParams.get('to') || undefined,
        limit: requestUrl.searchParams.get('limit') || undefined,
        offset: requestUrl.searchParams.get('offset') || undefined,
        query: requestUrl.searchParams.get('q') || undefined,
        window: requestUrl.searchParams.get('window') || undefined,
        status: requestUrl.searchParams.get('status') || undefined,
        channel: requestUrl.searchParams.get('channel') || undefined,
        domain: requestUrl.searchParams.get('domain') || undefined,
        type: requestUrl.searchParams.get('type') || undefined,
        jobs: []
      };

      let result;
      if (persistent) {
        result = await routeUserAdminRequest({ method: req.method, url: requestUrl.pathname, role, body, context, db });
        if (!result) result = await routeTenantReadRequest({ method: req.method, url: requestUrl.pathname, role, context, db });
        if (!result) result = await routePersistentRequest({ method: req.method, url: requestUrl.pathname, role, body, context, db });
      } else {
        result = routeRequest({ method: req.method, url: requestUrl.pathname, role, body, context });
      }

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
    return pathname === '/api/v1/users' || pathname === '/api/v1/users/roles' ||
      ['/api/v1/notifications/me','/api/v1/notifications/config'].includes(pathname) || ['/api/v1/customers/me','/api/v1/customers/me/orders','/api/v1/customers/me/assets','/api/v1/customers/me/jobs'].includes(pathname) ||
      pathname === '/api/v1/maintenance/stats' || pathname === '/api/v1/maintenance/assets' ||
      pathname === '/api/v1/jobs/stats' || pathname === '/api/v1/jobs' ||
      pathname === '/api/v1/jobs/escalations/stats' || pathname === '/api/v1/jobs/escalations' ||
      pathname === '/api/v1/technicians/stats' || pathname === '/api/v1/technicians' ||
      pathname === '/api/v1/settlements/stats' || pathname === '/api/v1/settlements' ||
      pathname === '/api/v1/reports/profitability' ||
      ['/api/v1/marketing/stats','/api/v1/marketing/segments','/api/v1/marketing/campaigns','/api/v1/marketing/audience-preview'].includes(pathname) ||
      ['/api/v1/marketing/abandoned-carts','/api/v1/marketing/abandoned-carts/stats'].includes(pathname) ||
      ['/api/v1/marketing/content','/api/v1/marketing/content/stats'].includes(pathname) ||
      pathname==='/api/v1/marketing/attribution' ||
      ['/api/v1/conversations','/api/v1/conversations/stats'].includes(pathname) || /^\/api\/v1\/conversations\/[^/]+$/.test(pathname) ||
      ['/api/v1/ai/stats','/api/v1/ai/suggestions','/api/v1/ai/knowledge'].includes(pathname) ||
      ['/api/v1/ai/insights/stats','/api/v1/ai/insights','/api/v1/ai/brief'].includes(pathname) ||
      ['/api/v1/ai/dispatch/stats','/api/v1/ai/dispatch/queue','/api/v1/ai/dispatch/recommendations'].includes(pathname) ||
      ['/api/v1/ai/sales/stats','/api/v1/ai/sales/opportunities'].includes(pathname) ||
      ['/api/v1/ai/marketing/stats','/api/v1/ai/marketing/recommendations'].includes(pathname) ||
      ['/api/v1/ai/finance/stats','/api/v1/ai/finance/anomalies'].includes(pathname) ||
      pathname === '/api/v1/inventory/stats' || pathname === '/api/v1/inventory' || pathname === '/api/v1/inventory/movements' ||
      pathname === '/api/v1/purchasing/stats' || pathname === '/api/v1/purchasing/suppliers' || pathname === '/api/v1/purchasing/orders' ||
      /^\/api\/v1\/technicians\/[^/]+\/inventory$/.test(pathname) ||
      /^\/api\/v1\/technicians\/[^/]+\/performance$/.test(pathname) ||
      /^\/api\/v1\/jobs\/[^/]+\/candidates$/.test(pathname) ||
      /^\/api\/v1\/customers(?:\/[^/]+)?(?:\/(?:timeline|addresses|assets|orders|jobs))?$/.test(pathname) ||
      /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+\/history$/.test(pathname) ||
      /^\/api\/v1\/technicians\/me\/jobs(?:\/[^/]+)?$/.test(pathname) ||
      pathname === '/api/v1/technicians/me/wallet';
  }
  if (method === 'POST') {
    return pathname === '/api/v1/users' ||
      ['/api/v1/notifications/subscriptions','/api/v1/notifications/subscriptions/disable'].includes(pathname) || /^\/api\/v1\/customers\/me\/jobs\/[^/]+\/rating$/.test(pathname) || pathname === '/api/v1/customers' || /^\/api\/v1\/customers\/[^/]+\/(?:addresses|assets)$/.test(pathname) ||
      /^\/api\/v1\/jobs\/[^/]+\/(?:assign|reassign)$/.test(pathname) ||
      pathname === '/api/v1/jobs/escalations/run' || /^\/api\/v1\/jobs\/[^/]+\/escalations\/resolve$/.test(pathname) ||
      ['/api/v1/inventory/items','/api/v1/inventory/receive','/api/v1/inventory/transfer','/api/v1/inventory/technician-issue'].includes(pathname) ||
      ['/api/v1/purchasing/suppliers','/api/v1/purchasing/orders'].includes(pathname) || /^\/api\/v1\/purchasing\/orders\/[^/]+\/(?:approve|receive)$/.test(pathname) ||
      ['/api/v1/marketing/segments','/api/v1/marketing/campaigns'].includes(pathname) || /^\/api\/v1\/marketing\/campaigns\/[^/]+\/launch$/.test(pathname) ||
      ['/api/v1/marketing/abandoned-carts','/api/v1/marketing/abandoned-carts/recovery/run'].includes(pathname) || /^\/api\/v1\/marketing\/abandoned-carts\/[^/]+\/recovered$/.test(pathname) ||
      pathname==='/api/v1/marketing/content' || /^\/api\/v1\/marketing\/content\/[^/]+\/transition$/.test(pathname) ||
      ['/api/v1/marketing/touches','/api/v1/marketing/spend'].includes(pathname) || /^\/api\/v1\/marketing\/orders\/[^/]+\/attribute$/.test(pathname) ||
      pathname==='/api/v1/conversations/inbound' || /^\/api\/v1\/conversations\/[^/]+\/reply$/.test(pathname) ||
      pathname==='/api/v1/ai/knowledge' || /^\/api\/v1\/ai\/conversations\/[^/]+\/suggest$/.test(pathname) || /^\/api\/v1\/ai\/suggestions\/[^/]+\/(approve|reject|use)$/.test(pathname) ||
      pathname==='/api/v1/ai/insights/run' ||
      /^\/api\/v1\/ai\/jobs\/[^/]+\/dispatch-recommendation$/.test(pathname) || /^\/api\/v1\/ai\/dispatch\/[^/]+\/(approve|reject)$/.test(pathname) ||
      pathname==='/api/v1/ai/sales/scan' ||
      pathname==='/api/v1/ai/marketing/scan' ||
      pathname==='/api/v1/ai/finance/scan' ||
      /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+\/maintenance$/.test(pathname) ||
      /^\/api\/v1\/technicians\/me\/jobs\/[^/]+\/complete$/.test(pathname) ||
      /^\/api\/v1\/settlements\/[^/]+\/(?:approve|reject|paid)$/.test(pathname);
  }
  if (method === 'PATCH' && /^\/api\/v1\/users\/[^/]+$/.test(pathname)) return true;
  if (method === 'PATCH' && pathname === '/api/v1/notifications/me') return true;
  return method === 'PATCH' && (/^\/api\/v1\/ai\/finance\/anomalies\/[^/]+$/.test(pathname) || /^\/api\/v1\/ai\/marketing\/recommendations\/[^/]+$/.test(pathname) || /^\/api\/v1\/ai\/sales\/opportunities\/[^/]+$/.test(pathname) || /^\/api\/v1\/ai\/insights\/[^/]+$/.test(pathname) || /^\/api\/v1\/conversations\/[^/]+$/.test(pathname) || /^\/api\/v1\/customers\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/customers\/[^/]+\/assets\/[^/]+$/.test(pathname) ||
    /^\/api\/v1\/technicians\/[^/]+\/status$/.test(pathname) ||
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
