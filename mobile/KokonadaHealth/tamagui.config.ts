import { createTamagui, createTokens } from '@tamagui/core';
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
    // AURORA additions — the muted supporting hue + the gold premium signature.
    kokoMuted: c.content.muted,
    kokoGlowIdle: c.accent.glowIdle,
    kokoGold: c.accent.gold,
    kokoGoldInk: c.accent.goldInk,
    kokoGoldGraphic: c.accent.goldGraphic,
  };
}

// The AURORA colour ramp as first-class Tamagui tokens ($sky / $violet / $gold / $pink), so
// Tamagui primitives can reach the brand gradient stops directly. tokens.ts remains the leaf
// source of truth — this only PROJECTS it, keeping the dependency edge config → tokens.
const auroraRamp = createTokens({
  color: {
    sky: colors.dark.aurora.blobs.sky.color,
    violet: colors.dark.aurora.blobs.violet.color,
    gold: colors.dark.accent.gold,
    pink: colors.dark.aurora.blobs.pink.color,
    glowIdle: colors.dark.accent.glowIdle,
    goldGraphic: colors.dark.accent.goldGraphic,
  },
});

// AURORA ships two named faces. `Nocturne`/`Day` are the design-language names; `dark`/`light`
// are the SCHEME keys Tamagui and App.tsx (`defaultTheme="dark"`) resolve against — so the same
// theme object is registered under both. Dropping dark/light would blank the provider.
const nocturne = { ...defaultConfig.themes.dark, ...themeFrom(colors.dark) };
const day = { ...defaultConfig.themes.light, ...themeFrom(colors.light) };

const tamaguiConfig = createTamagui({
  ...defaultConfig,
  themes: {
    ...defaultConfig.themes,
    dark: nocturne,
    light: day,
    Nocturne: nocturne,
    Day: day,
  },
  tokens: {
    ...defaultConfig.tokens,
    color: {
      ...defaultConfig.tokens.color,
      ...auroraRamp.color,
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
