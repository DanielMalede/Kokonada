import type { Cipher } from './cipher';

// Production Cipher for SecureStore. Real at-rest encryption is provided by the
// MMKV backend's native AES (key in the Keychain — see mmkvBackend). This adapter
// is the app-layer seam that SecureStore always routes values through; it is a
// passthrough today (double-encrypting MMKV's already-ciphertext file would add
// cost without threat-model benefit) and the single place to drop in an added
// app-layer AES-256-GCM if a future threat model (e.g. shared-key backup
// extraction) demands defense in depth. Kept out of the jest graph; SecureStore's
// cipher contract is exercised in tests with a reversible test double.
export const mmkvCipher: Cipher = {
  encrypt: (plain) => plain,
  decrypt: (blob) => blob,
};
