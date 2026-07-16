const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function parseKey(hex, label) {
  if (!hex || hex.length !== 64) {
    throw new Error(`${label} must be exactly 64 hex characters (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

// The primary key (ENCRYPTION_KEY) is always used for *encryption*. Previous keys
// (comma-separated in ENCRYPTION_KEY_PREVIOUS) are additionally tried on *decrypt*,
// so the key can be rotated without a bulk re-encrypt: set ENCRYPTION_KEY to the new
// key and move the old one into ENCRYPTION_KEY_PREVIOUS. GCM's auth tag makes a
// wrong-key attempt fail cleanly, so trying keys in turn is safe. (audit F8)
function getKeys() {
  const keys = [parseKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY')];
  const prev = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (prev) {
    for (const k of prev.split(',').map(s => s.trim()).filter(Boolean)) {
      keys.push(parseKey(k, 'ENCRYPTION_KEY_PREVIOUS'));
    }
  }
  return keys;
}

/**
 * Encrypts a value. Returns a base64 string: iv + authTag + ciphertext.
 * @param {string|object} value
 * @param {string|null} aad  Optional additional authenticated data (e.g. a userId)
 *   that binds this ciphertext to a context. The same aad must be supplied to
 *   decrypt(); it is authenticated but not stored in the blob.
 * @returns {string}
 */
function encrypt(value, aad = null) {
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const key = getKeys()[0];
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad != null) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64 string produced by encrypt(). Tries the primary key first,
 * then any rotation fallback keys.
 * @param {string} blob
 * @param {boolean} parseJson
 * @param {string|null} aad  Must match the aad used at encryption time, if any.
 * @returns {string|object}
 */
function decrypt(blob, parseJson = false, aad = null) {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  let lastErr;
  for (const key of getKeys()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      if (aad != null) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return parseJson ? JSON.parse(decrypted) : decrypted;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Decryption failed');
}

/**
 * Deterministic keyed blind index for an encrypted field. HMAC-SHA256 keyed by the primary
 * encryption key, so the SAME value always maps to the SAME index (queryable) while an
 * attacker without the key can't precompute it from the plaintext. Lets us look up a row by
 * an encrypted value (e.g. garminUserId) WITHOUT decrypting every document. (T3.3)
 * @param {string|null} value
 * @returns {string|null} hex digest, or null for null/empty input
 */
function blindIndex(value) {
  if (value == null || String(value) === '') return null;
  const key = getKeys()[0];
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}

/**
 * Rotation-safe LOOKUP indexes: the blind index under the primary key (first) AND under every
 * configured rotation key (ENCRYPTION_KEY_PREVIOUS). A value indexed before a key rotation stays
 * resolvable via `{ $in: blindIndexAll(v) }` with no reindex outage — the write path
 * (blindIndex) still uses the current key, so rows matched under an old key self-heal on next
 * save. (H2)
 * @param {string|null} value
 * @returns {string[]} hex digests (current key first), or [] for null/empty input
 */
function blindIndexAll(value) {
  if (value == null || String(value) === '') return [];
  return getKeys().map((key) => crypto.createHmac('sha256', key).update(String(value)).digest('hex'));
}

module.exports = { encrypt, decrypt, blindIndex, blindIndexAll };
