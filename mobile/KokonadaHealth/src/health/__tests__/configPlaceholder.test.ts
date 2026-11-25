// The tracked BACKEND_URL is a placeholder that the owner overlays locally. On 2026-11-24 an
// evidence build that still carried the old placeholder, `https://YOUR-BACKEND.up.railway.app`,
// was installed over a signed-in app: the boot sent `GET /api/auth/me` with the stored access token
// to that host, a real and claimable Railway name that is not the owner's. A placeholder must never
// resolve: `.invalid` is reserved by RFC 2606 and RFC 6761, so a request to it fails at name
// resolution and no header (and so no token) ever leaves the device.
import * as fs from 'fs';
import * as path from 'path';

import { BACKEND_URL } from '../config';

const CONFIG_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'config.ts'), 'utf8');

describe('the tracked BACKEND_URL placeholder can never reach a server', () => {
  it('is an https URL whose host ends in the reserved .invalid TLD', () => {
    const url = new URL(BACKEND_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname.endsWith('.invalid')).toBe(true);
  });

  it('names no Railway, Render, Fly, Vercel or other claimable hosting domain', () => {
    expect(CONFIG_SOURCE).not.toMatch(/\.(up\.railway\.app|onrender\.com|fly\.dev|vercel\.app|herokuapp\.com|netlify\.app)\b/i);
  });
});
