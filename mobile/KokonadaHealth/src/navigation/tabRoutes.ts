// The 5-tab shell's route contract — kept in a LEAF module so both the chrome (EmotionTabBar,
// TabIcon) and RootNavigator can read it without a cycle (RootNavigator → EmotionTabBar → TabIcon
// would otherwise close a loop back to a RootNavigator-owned constant). RootNavigator re-exports
// TAB_ROUTES so its long-standing export contract is preserved. Order IS the on-screen tab order.

export const TAB_ROUTES = ['Generate', 'NowPlaying', 'Pulse', 'History', 'Profile'] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

// The WORD label each tab wears (a11y + visible caption). "NowPlaying" is the route key; the tab
// reads "Now Playing" — colour is never the sole signal, so the word always carries the meaning.
export const TAB_LABELS: Record<TabRoute, string> = {
  Generate: 'Generate',
  NowPlaying: 'Now Playing',
  Pulse: 'Pulse',
  History: 'History',
  Profile: 'Profile',
};
