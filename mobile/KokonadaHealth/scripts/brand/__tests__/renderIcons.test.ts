import {
  adaptiveIconXml,
  backgroundDrawableXml,
  monochromeVectorXml,
  iosContentsJson,
} from '../renderIcons.mjs';
import { treatments } from '../../../src/design/brandMark.geometry';

// The launcher-manifest generators wire the three adaptive layers together and declare the
// iOS Any/Dark/Tinted appearances. These pin the XML/JSON structure; the real sharp render +
// dimension self-check is the closing evidence (run renderIcons.mjs).

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('renderIcons — launcher manifest generators', () => {
  it('the anydpi adaptive-icon references all THREE layers (foreground, abyss background, monochrome)', () => {
    const xml = adaptiveIconXml();
    expect(xml).toContain('<adaptive-icon');
    expect(xml).toContain('android:drawable="@mipmap/ic_launcher_foreground"');
    expect(xml).toContain('android:drawable="@drawable/ic_launcher_background"');
    expect(xml).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome"');
  });

  it('the background drawable is the flat abyss colour', () => {
    const xml = backgroundDrawableXml();
    expect(xml).toContain('<shape');
    expect(xml).toContain(`android:color="${treatments.dark.bg}"`);
  });

  it('the monochrome layer is a flat-white VectorDrawable silhouette — two rings + a core, NO accent', () => {
    const xml = monochromeVectorXml();
    expect(xml).toContain('<vector');
    expect(xml).toContain('android:viewportWidth="108"');
    expect(xml).toContain('android:pathData=');
    expect(count(xml, 'android:strokeColor="#FFFFFF"')).toBe(2); // two rings
    expect(xml).toContain('android:fillColor="#FFFFFF"'); // the seed core
    expect(xml).not.toContain(treatments.dark.ring); // no #31E1C4 — mono cannot glow
  });

  it('the iOS AppIcon declares a single 1024 with Any / Dark / Tinted appearances', () => {
    const json = iosContentsJson();
    expect(json.images).toHaveLength(3);
    expect(json.images.every((i) => i.size === '1024x1024')).toBe(true);
    expect(json.images.map((i) => i.filename)).toEqual([
      'Icon-1024-any.png',
      'Icon-1024-dark.png',
      'Icon-1024-tinted.png',
    ]);
    const appearances = json.images.flatMap((i) => (i.appearances ?? []).map((a) => a.value));
    expect(appearances).toEqual(['dark', 'tinted']);
    expect(json.info.author).toBe('xcode');
  });
});
