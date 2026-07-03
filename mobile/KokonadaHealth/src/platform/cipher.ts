// Port for a reversible symmetric cipher. The production adapter derives an
// AES-256-GCM key held in the Android Keystore / iOS Keychain (never in JS-visible
// storage); tests inject a deterministic reversible transform. Every value that
// SecureStore persists passes through this — nothing is written in plaintext.
export interface Cipher {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}
