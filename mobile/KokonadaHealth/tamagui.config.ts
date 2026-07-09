import { createTamagui } from '@tamagui/core';
import { defaultConfig } from '@tamagui/config/v4';
import { colors, type ColorScheme } from './src/design/tokens';

// Kokonada Tamagui config (Wave 2.8). The design tokens in src/design/tokens.ts are the
// single source of truth; here they flow into Tamagui so the provider theme and any
// Tamagui primitives render the brand palette. Screens read the richer semantic matrix
// through src/design/theme.ts useTheme(); this keeps TamaguiProvider brand-correct with
// its theme keys (background/color/borderColor) pointed at our values. We EXTEND
// defaultConfig (not replace) so the keys Tamagui's own components expect still exist.

// Map our semantic ColorScheme onto the theme keys Tamagui consumes + brand extras.
function themeFrom(c: ColorScheme) {
  return {
    background: c.surface.base,
    backgroundHover: c.surface.raised,
    backgroundPress: c.surface.overlay,
    backgroundFocus: c.surface.raised,
    borderColor: c.surface.hairline,
    borderColorHover: c.surface.hairline,
    color: c.content.primary,
    colorHover: c.content.primary,
    colorPress: c.content.secondary,
    placeholderColor: c.content.tertiary,
    // brand extras (namespaced so they can't collide with core keys)
    kokoSecondary: c.content.secondary,
    kokoTertiary: c.content.tertiary,
    kokoAccent: c.accent.glow,
    kokoAccentFill: c.accent.glowInk,
    kokoOnAccent: c.content.onAccent,
    kokoBloom: c.accent.bloom,
    kokoSuccess: c.state.success,
    kokoWarning: c.state.warning,
    kokoDanger: c.state.danger,
  };
}

const tamaguiConfig = createTamagui({
  ...defaultConfig,
  themes: {
    ...defaultConfig.themes,
    dark: { ...defaultConfig.themes.dark, ...themeFrom(colors.dark) },
    light: { ...defaultConfig.themes.light, ...themeFrom(colors.light) },
  },
  tokens: {
    ...defaultConfig.tokens,
    color: {
      ...defaultConfig.tokens.color,
      glow: colors.dark.accent.glow,
      glowInk: colors.dark.accent.glowInk,
      bloom: colors.dark.accent.bloom,
      abyss: colors.dark.surface.base,
      foam: colors.dark.content.primary,
    },
  },
});

export default tamaguiConfig;

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}
