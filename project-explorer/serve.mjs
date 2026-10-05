import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contentTypeFor,
  createCurrentCommitScript,
  resolveStaticPath,
} from './serve-core.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const MODULE_PATH = fileURLToPath(import.meta.url);
const STATIC_ROOT = path.dirname(MODULE_PATH);
const REPOSITORY_ROOT = path.resolve(STATIC_ROOT, '..');

function send(response, statusCode, body, contentType = 'text/plain; charset=utf-8', method = 'GET') {
  const payload = Buffer.from(body);
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': payload.byteLength,
    'X-Content-Type-Options': 'nosniff',
  });

  if (method === 'HEAD') {
    response.end();
  } else {
    response.end(payload);
  }
}

export function createExplorerServer({ rootPath = STATIC_ROOT, currentCommit = null } = {}) {
  return http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(response, 405, 'Method Not Allowed\n', undefined, method);
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url || '/', `http://${HOST}`).pathname;
    } catch (_error) {
      send(response, 400, 'Bad Request\n', undefined, method);
      return;
    }

    const filePath = resolveStaticPath(rootPath, request.url || '/');
    if (!filePath) {
      send(response, 403, 'Forbidden\n', undefined, method);
      return;
    }

    if (pathname === '/current-commit.js') {
      send(
        response,
        200,
        createCurrentCommitScript(currentCommit),
        'text/javascript; charset=utf-8',
        method,
      );
      return;
    }

    try {
      const body = await readFile(filePath);
      send(response, 200, body, contentTypeFor(filePath), method);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EISDIR')) {
        send(response, 404, 'Not Found\n', undefined, method);
        return;
      }

      send(response, 500, 'Internal Server Error\n', undefined, method);
    }
  });
}

function readPort(argumentsList) {
  const portIndex = argumentsList.indexOf('--port');
  if (portIndex < 0) {
    return DEFAULT_PORT;
  }

  const port = Number(argumentsList[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }

  return port;
}

function readCurrentCommit() {
  try {
    return execFileSync('git', ['-C', REPOSITORY_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch (_error) {
    return null;
  }
}

export function startExplorerServer(argumentsList = process.argv.slice(2)) {
  const port = readPort(argumentsList);
  const server = createExplorerServer({
    rootPath: STATIC_ROOT,
    currentCommit: readCurrentCommit(),
  });

  server.listen(port, HOST, () => {
    process.stdout.write(`Kokonada Project Explorer: http://${HOST}:${port}/\n`);
  });

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  startExplorerServer();
}
