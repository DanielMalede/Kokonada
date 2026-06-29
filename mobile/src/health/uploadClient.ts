import { BACKEND_URL } from './config';
import { getToken } from '../auth/tokenStore';
import type { BackendSample } from './mapToBackend';

// Matches the backend's MAX_BATCH (2000) in services/wearable/healthStore.js.
const CHUNK = 2000;

export interface UploadResult {
  accepted: number;   // total samples processed
  inserted: number;   // new heart-rate rows actually written (post-dedupe)
  profileMetrics: Record<string, number>;
}

// POST normalized samples to the ingest endpoint in chunks. The Kokonada JWT is
// read from secure storage (set by the Google sign-in flow); pass `token`
// explicitly only to override it.
export async function uploadSamples(samples: BackendSample[], token?: string): Promise<UploadResult> {
  const jwt = token ?? (await getToken());
  if (!jwt) throw new Error('Not signed in');

  let accepted = 0;
  let inserted = 0;
  let profileMetrics: Record<string, number> = {};

  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk = samples.slice(i, i + CHUNK);
    const res = await fetch(`${BACKEND_URL}/api/integrations/health/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ platform: 'health_connect', samples: chunk }),
    });

    if (!res.ok) {
      throw new Error(`Ingest failed (${res.status}) on chunk starting at ${i}`);
    }
    const json = await res.json();
    accepted += json.accepted ?? 0;
    inserted += json.inserted ?? 0;
    if (json.profileMetrics) profileMetrics = json.profileMetrics;
  }

  return { accepted, inserted, profileMetrics };
}
