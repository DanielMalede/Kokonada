// §4 Connect Services — the provider registry. The SINGLE source of truth for which
// integrations exist and their HONEST state today. A provider's `state` drives its row's
// visual language and, crucially, whether any connect action is offered at all:
//
//   • enabled  — a live connect path (the wearable/health path today).
//   • deferred — temporarily unavailable, expected back (YouTube: one OAuth-verification
//                blocker remaining before Google review completes).
//   • halted   — connecting is not available (Spotify: external constraint, no known fix).
//
// A halted/deferred provider offers NO OAuth CTA — the registry deliberately carries no
// connectUrl/oauth field so a row can never mistakenly wire a dead connect. The `why` line
// is the honest, compliance-cleared reason shown in the row and folded into its a11y label.

export type ProviderKind = 'music' | 'wearable';
export type ProviderState = 'enabled' | 'deferred' | 'halted';

export interface Provider {
  id: string;
  label: string; // plain-text service name — NEVER an official colored logo/wordmark
  kind: ProviderKind;
  state: ProviderState;
  why: string; // the honest reason line (also folded into the composed a11y label)
}

export const PROVIDERS: Provider[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    kind: 'music',
    state: 'halted',
    // compliance-auditor cleared copy (Spotify Developer Policy accurate-representation):
    // no agency attributed to Spotify, not read as platform-wide.
    why: "Connecting Spotify isn't available in Kokonada right now.",
  },
  {
    id: 'youtube',
    label: 'YouTube Music',
    kind: 'music',
    state: 'deferred',
    why: 'Coming once our Google review is complete.',
  },
  {
    id: 'wearable',
    label: 'Wearable & Health',
    kind: 'wearable',
    state: 'enabled',
    why: 'Read only with your explicit say-so, to shape music to your body.',
  },
];

export function providersByKind(kind: ProviderKind): Provider[] {
  return PROVIDERS.filter((p) => p.kind === kind);
}
