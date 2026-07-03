import { apiPost } from '../net/apiClient';
import type { BackendSample } from './mapToBackend';

// Matches the backend's MAX_BATCH (2000) in services/wearable/healthStore.js.
const CHUNK = 2000;

export interface UploadResult {
  accepted: number;   // total samples processed
  inserted: number;   // new heart-rate rows actually written (post-dedupe)
  profileMetrics: Record<string, number>;
}

interface BatchResponse {
  accepted?: number;
  inserted?: number;
  profileMetrics?: Record<string, number>;
}

// POST normalized samples to the ingest endpoint in chunks via the shared apiClient,
// which authenticates from the unified AuthSession plane and transparently refreshes
// a 401 once before retrying — no explicit JWT read needed.
export async function uploadSamples(samples: BackendSample[]): Promise<UploadResult> {
  let accepted = 0;
  let inserted = 0;
  let profileMetrics: Record<string, number> = {};

  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk = samples.slice(i, i + CHUNK);
    const res = await apiPost<BatchResponse>('/api/integrations/health/batch', {
      platform: 'health_connect',
      samples: chunk,
    });

    if (!res.ok) {
      throw new Error(`Ingest failed (${res.status ?? 'network'}) on chunk starting at ${i}`);
    }
    accepted += res.data.accepted ?? 0;
    inserted += res.data.inserted ?? 0;
    if (res.data.profileMetrics) profileMetrics = res.data.profileMetrics;
  }

  return { accepted, inserted, profileMetrics };
}
