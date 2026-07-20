/**
 * @format
 */

import tamaguiConfig from '../tamagui.config';

test('tamagui config builds without throwing', () => {
  expect(tamaguiConfig).toBeDefined();
  expect(tamaguiConfig.fonts).toBeDefined();
  expect(tamaguiConfig.themes).toBeDefined();
});

// The Aurora projection ADDS the named themes (Day / Nocturne) WITHOUT dropping the scheme keys
// Tamagui + App.tsx depend on (`defaultTheme="dark"`). Losing dark/light would blank the provider.
test('projects the Aurora themes (Day / Nocturne) while KEEPING the dark/light scheme keys', () => {
  const themes = tamaguiConfig.themes as Record<string, Record<string, unknown> | undefined>;
  for (const key of ['dark', 'light', 'Nocturne', 'Day']) {
    expect(themes[key]).toBeDefined();
  }
  // the aliases are genuine projections of their scheme twin, not empty placeholders.
  // (Tamagui wraps each theme value in its own Variable instance, so compare BY VALUE.)
  expect(themes.Nocturne?.background).toEqual(themes.dark?.background);
  expect(themes.Day?.background).toEqual(themes.light?.background);
});

test('exposes the Aurora colour ramp as Tamagui tokens', () => {
  const color = tamaguiConfig.tokens.color as Record<string, unknown>;
  for (const key of ['sky', 'violet', 'gold', 'pink', 'glowIdle']) {
    expect(color[key]).toBeDefined();
  }
});
