// Port for a synchronous key-value store. The production adapter (mmkvBackend)
// wraps an encrypted react-native-mmkv instance; tests inject an in-memory fake.
// `encrypted` is a hard flag SecureStore asserts on construction so a plaintext
// store can never be wired in by accident.
export interface KVBackend {
  encrypted: boolean;
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
  clearAll(): void;
}
