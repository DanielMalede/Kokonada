// Hand-written type declarations for the plain-ESM rotate-csp-nonce.mjs script
// (kept as .mjs, not .ts, so it stays directly runnable via `node scripts/...mjs`
// as the frontend's `prebuild` step, with no build/transpile step of its own).
export declare const VERCEL_JSON_PATH: string;
export declare function generateNonce(): string;
export declare function hardenCsp(currentValue: string, nonce: string): string;
export declare function readCurrentNonce(path?: string): string | null;
export declare function rotate(options?: { path?: string; nonce?: string }): string;
