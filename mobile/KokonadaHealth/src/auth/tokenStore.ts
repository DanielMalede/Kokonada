import * as Keychain from 'react-native-keychain';

// Secure storage for the Kokonada JWT (Android Keystore-backed via react-native-keychain).
const SERVICE = 'com.kokonadahealth.jwt';

export async function saveToken(token: string): Promise<void> {
  await Keychain.setGenericPassword('jwt', token, { service: SERVICE });
}

export async function getToken(): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  return creds ? creds.password : null;
}

export async function clearToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
