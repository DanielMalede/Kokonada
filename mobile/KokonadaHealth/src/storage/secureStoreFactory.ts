import { SecureStore } from './secureStore';
import { createEncryptedBackend } from '../platform/mmkvBackend';
import { mmkvCipher } from '../platform/mmkvCipher';

// Production SecureStore construction: the encrypted MMKV backend (key in the
// Keychain) behind the SecureStore guard. Async because the Keychain read is async.
// Native — outside the jest graph; SecureStore's logic is unit-tested with fakes.
export async function createSecureStore(): Promise<SecureStore> {
  const backend = await createEncryptedBackend();
  return new SecureStore({ backend, cipher: mmkvCipher });
}
