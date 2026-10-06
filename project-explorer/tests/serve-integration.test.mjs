import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';

import { createExplorerServer } from '../serve.mjs';

const rootPath = path.resolve('project-explorer');
const commit = '55d68cc1bb42b7bb6f089582c2d9206f8548ac71';

function requestStatus(baseUrl, requestPath) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      method: 'GET',
      path: requestPath,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

async function withServer(run, options = { currentCommit: commit }) {
  const server = createExplorerServer({ rootPath, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('serves the dashboard and dynamic checkout commit on loopback', async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    const commitScript = await fetch(`${baseUrl}/current-commit.js`);

    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Kokonada Project Explorer<\/title>/);
    assert.equal(commitScript.status, 200);
    assert.equal(
      await commitScript.text(),
      `window.__KOKONADA_CURRENT_COMMIT__ = ${JSON.stringify(commit)};\n`,
    );
  });
});

test('refreshes the checkout commit on every virtual endpoint request', async () => {
  let liveCommit = commit;

  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/current-commit.js`);
    liveCommit = '9cd2adec3da0c953a844ee8a6b10c4bd64c5baec';
    const second = await fetch(`${baseUrl}/current-commit.js`);

    assert.match(await first.text(), new RegExp(commit));
    assert.match(await second.text(), new RegExp(liveCommit));
    assert.match(first.headers.get('cache-control') || '', /no-store/);
    assert.match(second.headers.get('cache-control') || '', /no-store/);
  }, { readCurrentCommit: () => liveCommit });
});

test('returns explicit status codes for unsupported requests', async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/missing.txt`);
    const wrongMethod = await fetch(`${baseUrl}/`, { method: 'POST' });
    const traversalStatus = await requestStatus(baseUrl, '/%2e%2e/secret.txt');
    const virtualTraversalStatus = await requestStatus(baseUrl, '/%2e%2e/current-commit.js');

    assert.equal(missing.status, 404);
    assert.equal(wrongMethod.status, 405);
    assert.equal(traversalStatus, 403);
    assert.equal(virtualTraversalStatus, 403);
  });
});
