import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  resolveStaticPath,
  contentTypeFor,
  createCurrentCommitScript,
} from '../serve-core.mjs';

const root = path.resolve('project-explorer');

test('maps the root request to index.html', () => {
  assert.equal(resolveStaticPath(root, '/'), path.join(root, 'index.html'));
});

test('keeps ordinary asset requests inside the static root', () => {
  assert.equal(resolveStaticPath(root, '/styles.css'), path.join(root, 'styles.css'));
  assert.equal(resolveStaticPath(root, '/tests/example.js'), path.join(root, 'tests', 'example.js'));
});

test('rejects plain and encoded traversal attempts', () => {
  assert.equal(resolveStaticPath(root, '/../secret.txt'), null);
  assert.equal(resolveStaticPath(root, '/%2e%2e/secret.txt'), null);
  assert.equal(resolveStaticPath(root, '/nested/%2E%2E/%2E%2E/secret.txt'), null);
  assert.equal(resolveStaticPath(root, '/%E0%A4%A'), null);
});

test('ignores query strings when resolving a static file', () => {
  assert.equal(resolveStaticPath(root, '/styles.css?cache=1'), path.join(root, 'styles.css'));
});

test('returns safe content types for supported and unknown files', () => {
  assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('styles.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('serve.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('asset.bin'), 'application/octet-stream');
});

test('creates a serialized commit assignment only for a valid full SHA', () => {
  const sha = '55d68cc1bb42b7bb6f089582c2d9206f8548ac71';

  assert.equal(
    createCurrentCommitScript(sha),
    `window.__KOKONADA_CURRENT_COMMIT__ = ${JSON.stringify(sha)};\n`,
  );
  assert.equal(createCurrentCommitScript('55d68cc'), 'window.__KOKONADA_CURRENT_COMMIT__ = null;\n');
  assert.equal(createCurrentCommitScript('not-a-sha'), 'window.__KOKONADA_CURRENT_COMMIT__ = null;\n');
});
