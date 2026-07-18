import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { space } from '../design/tokens';
import type { TabRoute } from './tabRoutes';

// Skia token-drawn tab glyphs — the deliberate answer to the vector-icon tofu (a bundled icon font
// substitutes to □ when only some families link, and recurs on every Metro reload). Skia paints
// vectors on the GPU: there is NO font and NO glyph table, so a tab icon CANNOT tofu. It tints
// natively with the emotionAccent ink the chrome passes down and needs no native rebuild.
//
// Each glyph is built from primitives the whole stack supports — moveTo / lineTo / addCircle / close
// — in a normalised 0..size box (the coordinate fractions are glyph ART, the RadialWheel-DOT_BASE
// precedent, not layout magic; glyph FIDELITY is device-verified via screenshots + the designer
// SHIP, per R6). Active = a filled paint; inactive = an outline — a SHAPE signal so colour is never
// the sole active/inactive cue. The glyph is decorative: the accessible label rides on the tab.

// Glyph stroke ≈ 2 at the space.xl (24) icon size — a proportion, so it scales with any size.
const STROKE_RATIO = 1 / 12;

type GlyphBuilder = (p: SkPath, s: number) => void;

// Generate (HERO) — a soft 4-point create/aura sparkle (echoes the discovery mark). Deliberately a
// concave star, NOT Spotify's 3-bar soundwave-in-circle (compliance C4); its hue is the passed ink,
// never Spotify green.
const generateGlyph: GlyphBuilder = (p, s) => {
  const cx = s / 2, cy = s / 2, ro = s * 0.42, ri = s * 0.15;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 4);
    const r = i % 2 === 0 ? ro : ri;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.close();
};

// Now Playing — two beamed eighth-notes (note-heads + stems + beam).
const nowPlayingGlyph: GlyphBuilder = (p, s) => {
  const cx = s / 2, cy = s / 2;
  const headR = s * 0.1, headY = cy + s * 0.17;
  const lx = cx - s * 0.17, rx = cx + s * 0.15;
  p.addCircle(lx, headY, headR);
  p.addCircle(rx, headY, headR);
  const stemW = s * 0.05, stemLx = lx + headR * 0.9, stemRx = rx + headR * 0.9;
  const beamTop = cy - s * 0.27, beamBot = beamTop + s * 0.1;
  // left stem
  p.moveTo(stemLx - stemW, headY); p.lineTo(stemLx, headY); p.lineTo(stemLx, beamTop); p.lineTo(stemLx - stemW, beamTop); p.close();
  // right stem
  p.moveTo(stemRx - stemW, headY); p.lineTo(stemRx, headY); p.lineTo(stemRx, beamTop); p.lineTo(stemRx - stemW, beamTop); p.close();
  // beam across the stem-tops
  p.moveTo(stemLx - stemW, beamTop); p.lineTo(stemRx, beamTop); p.lineTo(stemRx, beamBot); p.lineTo(stemLx - stemW, beamBot); p.close();
};

// Pulse — a LITERAL heartbeat / ECG waveform (avoids the heart=favourite confusion). An open
// polyline: baseline → small rise → deep dip → tall spike → settle → baseline.
const pulseGlyph: GlyphBuilder = (p, s) => {
  const pts: [number, number][] = [
    [0.12, 0.5], [0.32, 0.5], [0.41, 0.36], [0.5, 0.72],
    [0.58, 0.2], [0.66, 0.54], [0.78, 0.5], [0.88, 0.5],
  ];
  pts.forEach(([fx, fy], i) => { const x = fx * s, y = fy * s; if (i === 0) p.moveTo(x, y); else p.lineTo(x, y); });
};

// History — a thin clock (time, not an alarm): a rim + hour and minute hands.
const historyGlyph: GlyphBuilder = (p, s) => {
  const cx = s / 2, cy = s / 2, r = s * 0.34;
  p.addCircle(cx, cy, r);
  p.moveTo(cx, cy); p.lineTo(cx, cy - r * 0.52);          // hour hand → 12
  p.moveTo(cx, cy); p.lineTo(cx + r * 0.6, cy + r * 0.18); // minute hand → ~4
};

// Profile — a person bust (head + shoulders). The privacy shield lives INSIDE the Vault, not here.
const profileGlyph: GlyphBuilder = (p, s) => {
  const cx = s / 2, cy = s / 2;
  p.addCircle(cx, cy - s * 0.14, s * 0.13);
  const shW = s * 0.26, neckW = s * 0.1, botY = cy + s * 0.3, topY = cy + s * 0.03, curveY = topY + s * 0.06;
  p.moveTo(cx - shW, botY);
  p.lineTo(cx - shW, curveY);
  p.lineTo(cx - neckW, topY);
  p.lineTo(cx + neckW, topY);
  p.lineTo(cx + shW, curveY);
  p.lineTo(cx + shW, botY);
  p.close();
};

const GLYPHS: Record<TabRoute, GlyphBuilder> = {
  Generate: generateGlyph,
  NowPlaying: nowPlayingGlyph,
  Pulse: pulseGlyph,
  History: historyGlyph,
  Profile: profileGlyph,
};

export interface TabIconProps {
  route: TabRoute;
  color: string;
  size?: number;
  filled?: boolean;
}

export function TabIcon({ route, color, size = space.xl, filled = false }: TabIconProps) {
  const path = useMemo(() => { const p = Skia.Path.Make(); GLYPHS[route](p, size); return p; }, [route, size]);
  return (
    <View
      testID={`tab-icon-${route}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Canvas style={{ width: size, height: size }}>
        <Path
          path={path}
          color={color}
          style={filled ? 'fill' : 'stroke'}
          strokeWidth={size * STROKE_RATIO}
          strokeJoin="round"
          strokeCap="round"
        />
      </Canvas>
    </View>
  );
}
