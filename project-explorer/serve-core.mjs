import path from 'node:path';

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function decodePathname(value) {
  try {
    return decodeURIComponent(value).replaceAll('\\', '/');
  } catch (_error) {
    return null;
  }
}

function hasTraversal(pathname) {
  return pathname.split('/').some((segment) => segment === '..');
}

export function resolveStaticPath(rootPath, requestUrl) {
  const root = path.resolve(rootPath);
  const rawPathname = String(requestUrl || '/').split(/[?#]/, 1)[0] || '/';
  const decodedRawPathname = decodePathname(rawPathname);

  if (decodedRawPathname === null || hasTraversal(decodedRawPathname)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(String(requestUrl || '/'), 'http://127.0.0.1');
  } catch (_error) {
    return null;
  }

  const pathname = decodePathname(parsed.pathname);
  if (pathname === null || pathname.includes('\0') || hasTraversal(pathname)) {
    return null;
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolved);

  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return resolved;
}

export function contentTypeFor(filePath) {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
  };

  return contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function createCurrentCommitScript(commit) {
  const value = FULL_SHA_PATTERN.test(commit || '') ? commit : null;
  return `window.__KOKONADA_CURRENT_COMMIT__ = ${JSON.stringify(value)};\n`;
}
