import http from 'node:http';
import { routeRequest } from './http/router.mjs';

const port = Number(process.env.PORT || 3001);

const server = http.createServer(async (req, res) => {
  try {
    const body = await readJson(req);
    const result = routeRequest({
      method: req.method,
      url: req.url,
      role: req.headers['x-subil-role'] || 'anonymous',
      body,
      context: {
        userId: req.headers['x-subil-user-id'] || null,
        jobs: []
      }
    });
    res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result.data));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bad_request' }));
  }
});

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
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

server.listen(port, () => {
  console.log(`SUBIL API listening on ${port}`);
});
