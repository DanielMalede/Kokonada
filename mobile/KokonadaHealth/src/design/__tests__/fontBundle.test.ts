import { existsSync } from 'fs';
import { resolve } from 'path';
import { type, fontFace } from '../tokens';

// The bundling CONTRACT for the Manrope rollout: the five static faces are physically present
// in assets/fonts, react-native.config.js points the asset linker at that folder, and the type
// tokens resolve to Manrope. If a face goes missing or the token drifts back to a placeholder,
// this fails here — before a tofu'd wordmark ships to a device.

const PROJECT_ROOT = resolve(__dirname, '../../..');
const FONT_DIR = resolve(PROJECT_ROOT, 'assets/fonts');

describe('Manrope is bundled + wired for the whole app', () => {
  it('react-native.config.js links the assets/fonts folder for native linking', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(resolve(PROJECT_ROOT, 'react-native.config.js'));
    expect(config.assets).toContain('./assets/fonts');
  });

  it('the display + text type tokens both resolve to Manrope', () => {
    expect(type.family.display).toBe('Manrope');
    expect(type.family.text).toBe('Manrope');
  });

  it.each(Object.values(fontFace))('the bundled face %s.ttf exists in assets/fonts', (face) => {
    expect(existsSync(resolve(FONT_DIR, `${face}.ttf`))).toBe(true);
  });

  it('bundles exactly the five static Manrope weights (400/500/600/700/800)', () => {
    const files = ['Manrope-Regular', 'Manrope-Medium', 'Manrope-SemiBold', 'Manrope-Bold', 'Manrope-ExtraBold'];
    for (const f of files) expect(existsSync(resolve(FONT_DIR, `${f}.ttf`))).toBe(true);
    // the retired display face must be gone (no General Sans left in the bundle).
    expect(existsSync(resolve(FONT_DIR, 'GeneralSans-Semibold.otf'))).toBe(false);
  });
});
