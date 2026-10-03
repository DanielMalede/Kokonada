// Reading the token sources: design-tokens/*.tokens.json at the repo root. No import.meta here, so
// the module also loads under jest; the CLI passes the directory in.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BASE_FILE = 'base.tokens.json';
export const DIRECTION_FILE = /^direction\.([a-z][a-z0-9-]*)\.tokens\.json$/;

/** Every .json file in `dir`, sorted by name, as { name, bytes, json }. */
export function readTokenSources(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(dir, name));
      let json;
      try {
        json = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new Error(`${name}: not valid JSON: ${error.message}`);
      }
      return { name, bytes, json };
    });
}

/** The hash TOKENS_SOURCE records: sha256 of the file's raw bytes (LF line endings, .gitattributes). */
export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
