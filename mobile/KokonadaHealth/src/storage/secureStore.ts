import type { KVBackend } from '../platform/kvBackend';
import type { Cipher } from '../platform/cipher';

// Namespaces that must NEVER touch disk. Raw biometrics live only in the
// ephemeral warm/hot lanes; the zero-knowledge posture means they are derived on
// the server, never cached on the device. This denylist is belt-and-suspenders:
// even a coding mistake that routes an HR value here is refused, not persisted.
const FORBIDDEN_PREFIX = /^(bio|hr|biometric)\s*:/i;

export interface SecureStoreDeps {
  backend: KVBackend;
  cipher: Cipher;
}

// The only sanctioned persistence path on the device. Encrypted-at-rest (the
// backend is an encrypted MMKV instance AND every value is ciphered on top),
// biometric-denying, and fail-soft: a full or interrupted backend degrades to a
// return value, never a thrown exception into the UI thread.
export class SecureStore {
  private readonly backend: KVBackend;
  private readonly cipher: Cipher;

  constructor({ backend, cipher }: SecureStoreDeps) {
    if (!backend.encrypted) {
      throw new Error('SecureStore requires an encrypted backend — refusing a plaintext store');
    }
    this.backend = backend;
    this.cipher = cipher;
  }

  private isForbidden(key: string): boolean {
    return FORBIDDEN_PREFIX.test(key);
  }

  // Returns true on success, false if the value could not be persisted (storage
  // full, interrupted write, forbidden key). Never throws.
  setItem(key: string, value: string): boolean {
    if (this.isForbidden(key)) return false;
    try {
      this.backend.set(key, this.cipher.encrypt(value));
      return true;
    } catch {
      return false; // storage full / interrupted — prior value (if any) is untouched
    }
  }

  // Returns null for missing, forbidden, or undecryptable values. Never throws.
  getItem(key: string): string | null {
    if (this.isForbidden(key)) return null;
    let raw: string | undefined;
    try {
      raw = this.backend.getString(key);
    } catch {
      return null;
    }
    if (raw === undefined) return null;
    try {
      return this.cipher.decrypt(raw);
    } catch {
      return null; // corrupt / partially-written ciphertext
    }
  }

  removeItem(key: string): void {
    try {
      this.backend.delete(key);
    } catch {
      /* best-effort */
    }
  }

  // Scoped erase: delete every key whose name begins with `prefix`. This is the surgical
  // alternative to clearAll — logout wipes ALL cold intent (the `cold.` namespace, every
  // user) so no committed intent survives a user switch, WITHOUT nuking device-level
  // preferences that share this one encrypted instance (e.g. koko.onboarding.seen,
  // koko.liveMode). Fail-soft: a throwing enumeration or delete degrades to a no-op.
  removeByPrefix(prefix: string): void {
    try {
      for (const key of this.backend.getAllKeys()) {
        if (key.startsWith(prefix)) this.backend.delete(key);
      }
    } catch {
      /* best-effort — a failing wipe must never throw into logout teardown */
    }
  }

  // Full erasure of the entire encrypted instance. Use with care — it also removes
  // device preferences (onboarding-seen, live-mode); prefer removeByPrefix for a
  // scoped, account-safe wipe.
  clearAll(): void {
    try {
      this.backend.clearAll();
    } catch {
      /* best-effort */
    }
  }
}
