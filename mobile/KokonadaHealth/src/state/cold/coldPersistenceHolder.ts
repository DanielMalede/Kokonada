import type { ColdPersistence } from './coldPersistence';

// Holds the live ColdPersistence instance created at bootstrap so logout can wipe it.
// (bootstrapApp constructs it once the user is known; the Profile teardown needs a
// handle to call wipe().)
let instance: ColdPersistence | null = null;

export function setColdPersistence(cp: ColdPersistence | null): void {
  instance = cp;
}

export function wipeColdPersistence(): void {
  if (instance) {
    instance.wipe();
    instance = null;
  }
}
