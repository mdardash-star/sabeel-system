import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.mjs';

async function withServer(db, run) {
  const server = createApiServer({ db, auth: {}, corsOrigins: [] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('ready returns 503 when database is missing', async () => {
  await withServer(null, async base => {
    const response = await fetch(`${base}/ready`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, 'not_ready');
    assert.equal(body.database, 'missing');
  });
});

test('ready returns 200 when database responds', async () => {
  const db = { query: async sql => {
    assert.match(sql, /SELECT 1/);
    return { rows: [{ ok: 1 }] };
  }};
  await withServer(db, async base => {
    const response = await fetch(`${base}/ready`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ready');
    assert.equal(body.database, 'ok');
  });
});
