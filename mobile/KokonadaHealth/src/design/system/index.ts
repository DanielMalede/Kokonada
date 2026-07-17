// Shared SYSTEM-STATE primitives (§0 "E1") — the foundational, reusable pieces every screen
// inherits for loading, empty, and offline states. Tokens only (via useTheme/useMotion), reduced-
// motion honoured centrally, no third-party marks. Screens import from here, never from the files.

export { useCalmPulse, type CalmPulseCurve } from './useCalmPulse';
export {
  Skeleton,
  SKELETON_PULSE,
  type SkeletonProps,
  type SkeletonVariant,
  type SkeletonSurface,
} from './Skeleton';
export {
  EmptyState,
  EMPTY_GLOW_OPACITY,
  type EmptyStateProps,
  type EmptyStateAction,
} from './EmptyState';
export {
  OfflineBanner,
  OFFLINE_GRACE_MS,
  BACK_ONLINE_HOLD_MS,
  type OfflineBannerProps,
  type BannerStatus,
} from './OfflineBanner';
