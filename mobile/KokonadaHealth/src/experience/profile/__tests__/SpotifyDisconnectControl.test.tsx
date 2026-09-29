import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SpotifyDisconnectControl, SPOTIFY_DISCONNECT_COPY } from '../SpotifyDisconnectControl';
import { colors, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../../design/contrast';

// Cold-require headroom (same rationale as VaultConsentPanel.test.tsx): the first render in a cold
// jest worker pays the module-graph compile.
jest.setTimeout(20000);

// HX-2 M8/M9 (DEC-100) — Disconnect Spotify on the Profile Spotify row. Two taps: Disconnect, then
// confirm. The confirm copy is compliance-cleared and EXACT; every clause is true of the server purge
// (spotifyDisconnectErasure.integration.test.js), and it must change if a clause stops being true.

const EXACT = {
  title: 'Disconnect Spotify?',
  line1: 'Kokonada will stop using your Spotify account and delete your Spotify connection, the music profile built from it, and the Spotify tracks listed in History. Your moments stay.',
  line2: 'To remove Kokonada from your Spotify account as well, go to spotify.com/account/apps and choose Remove access.',
  line3: "You can't reconnect Spotify in this version.",
  confirm: 'Disconnect',
  cancel: 'Cancel',
  failureTitle: 'Could not disconnect Spotify',
  failureBody: 'Please try again in a moment.',
};

// Forcing the face without leaking it (see VaultConsentPanel.test.tsx for why spyOn cannot).
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);
const FACES: ThemeName[] = ['light', 'dark'];

const flattenStyle = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const firstText = (node: any) => node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')[0];
const hostTexts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text');
const textOf = (node: any): string => (node.children || []).map((ch: any) => (typeof ch === 'string' ? ch : textOf(ch))).join('');
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function');
const allText = (tree: ReactTestRenderer.ReactTestRenderer) => hostTexts(tree).map(textOf);

function render(props: Partial<React.ComponentProps<typeof SpotifyDisconnectControl>> = {}) {
  const onConfirm = jest.fn();
  const haptic = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SpotifyDisconnectControl busy={false} showNoReconnectLine onConfirm={onConfirm} triggerHaptic={haptic} {...props} />,
    );
  });
  return { tree, onConfirm, haptic };
}
const press = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  ReactTestRenderer.act(() => { byTestId(tree, id)[0].props.onPress(); });

afterEach(() => releaseFace());

describe('SpotifyDisconnectControl — two taps', () => {
  it('first shows only the Disconnect action; the first tap opens the confirm and disconnects nothing', () => {
    const { tree, onConfirm } = render();
    expect(byTestId(tree, 'disconnect-spotify')).toHaveLength(1);
    expect(allText(tree)).not.toContain(EXACT.title);

    press(tree, 'disconnect-spotify');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(allText(tree)).toContain(EXACT.title);
  });

  it('the second tap — the confirm\'s Disconnect — disconnects, once', () => {
    const { tree, onConfirm } = render();
    press(tree, 'disconnect-spotify');

    press(tree, 'disconnect-spotify-confirm');

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes the confirm without disconnecting', () => {
    const { tree, onConfirm } = render();
    press(tree, 'disconnect-spotify');

    press(tree, 'disconnect-spotify-cancel');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(allText(tree)).not.toContain(EXACT.title);
    expect(byTestId(tree, 'disconnect-spotify')).toHaveLength(1);
  });

  it('while the call runs, the confirm cannot be pressed again', () => {
    const { tree } = render({ busy: true });
    press(tree, 'disconnect-spotify');
    const confirm = byTestId(tree, 'disconnect-spotify-confirm')[0];
    expect(confirm.props.disabled).toBe(true);
    expect(confirm.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }));
  });

  it('confirming is a destructive commit: one warning haptic', () => {
    const { tree, haptic } = render();
    press(tree, 'disconnect-spotify');
    press(tree, 'disconnect-spotify-confirm');
    expect(haptic).toHaveBeenCalledWith('warning');
  });
});

describe('SpotifyDisconnectControl — the confirm copy is exact (M9)', () => {
  it('title, the two body lines, and the two buttons, word for word and in this order', () => {
    const { tree } = render();
    press(tree, 'disconnect-spotify');
    const lines = allText(tree);
    const order = [EXACT.title, EXACT.line1, EXACT.line2, EXACT.line3, EXACT.cancel, EXACT.confirm].map((l) => lines.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('line 3 ("You can\'t reconnect…") appears only while SPOTIFY_BETA_CONNECT is off', () => {
    const off = render({ showNoReconnectLine: true });
    press(off.tree, 'disconnect-spotify');
    expect(allText(off.tree)).toContain(EXACT.line3);

    const on = render({ showNoReconnectLine: false });
    press(on.tree, 'disconnect-spotify');
    expect(allText(on.tree)).not.toContain(EXACT.line3);
  });

  it('exports the copy the screen uses for the failure alert, exactly', () => {
    expect(SPOTIFY_DISCONNECT_COPY).toEqual(expect.objectContaining({
      title: EXACT.title, body: EXACT.line1, removeAccess: EXACT.line2, noReconnect: EXACT.line3,
      confirm: EXACT.confirm, cancel: EXACT.cancel, failureTitle: EXACT.failureTitle, failureBody: EXACT.failureBody,
    }));
  });

  it('never claims more than the purge does: no "revoke", no "all", no promise to reconnect', () => {
    const { tree } = render({ showNoReconnectLine: false });
    press(tree, 'disconnect-spotify');
    const copy = allText(tree).join(' ');
    expect(copy).not.toMatch(/revok/i);
    expect(copy).not.toMatch(/\ball\b/i);
    expect(copy).not.toMatch(/reconnect (any ?time|later|whenever)/i);
  });
});

describe.each(FACES)('SpotifyDisconnectControl — %s face', (face) => {
  const C = colors[face];

  it('the destructive Disconnect wears this face\'s danger hue, readable on the raised card (AA)', () => {
    forceFace(face);
    const { tree } = render();
    press(tree, 'disconnect-spotify');
    const confirm = byTestId(tree, 'disconnect-spotify-confirm')[0];
    const label = flattenStyle(firstText(confirm)).color;
    expect(label).toBe(C.state.danger);
    expect(flattenStyle(confirm).borderColor).toBe(C.state.danger);
    expect(contrastRatio(label, C.surface.raised)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('Cancel is neutral, and every line of copy is readable on the raised card (AA)', () => {
    forceFace(face);
    const { tree } = render();
    press(tree, 'disconnect-spotify');
    const cancel = byTestId(tree, 'disconnect-spotify-cancel')[0];
    expect(flattenStyle(firstText(cancel)).color).toBe(C.content.primary);
    for (const t of hostTexts(tree)) {
      expect(contrastRatio(flattenStyle(t).color, C.surface.raised)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the first-tap action is a quiet text button in this face (content.secondary), not a danger link', () => {
    forceFace(face);
    const { tree } = render();
    expect(flattenStyle(firstText(byTestId(tree, 'disconnect-spotify')[0])).color).toBe(C.content.secondary);
  });
});

describe('SpotifyDisconnectControl — font scale 2.0 and accessibility', () => {
  it('nothing truncates, nothing opts out of font scaling, and no container fixes a height', () => {
    const { tree } = render();
    press(tree, 'disconnect-spotify');
    for (const t of hostTexts(tree)) {
      expect(t.props.numberOfLines).toBeUndefined();
      expect(t.props.allowFontScaling).not.toBe(false);
      expect(t.props.adjustsFontSizeToFit).not.toBe(true);
    }
    for (const n of tree.root.findAll((x) => typeof x.type === 'string')) {
      expect(flattenStyle(n).height).toBeUndefined();
      expect(flattenStyle(n).maxHeight).toBeUndefined();
    }
  });

  it('every control is a button with a human name and a ≥44dp target; the title is a header', () => {
    const { tree } = render();
    const trigger = byTestId(tree, 'disconnect-spotify')[0];
    expect(trigger.props.accessibilityRole).toBe('button');
    expect(trigger.props.accessibilityLabel).toBe('Disconnect Spotify');
    expect(trigger.props.hitSlop).toBeGreaterThan(0);
    press(tree, 'disconnect-spotify');
    for (const id of ['disconnect-spotify-cancel', 'disconnect-spotify-confirm']) {
      const b = byTestId(tree, id)[0];
      expect(b.props.accessibilityRole).toBe('button');
      expect(typeof b.props.accessibilityLabel).toBe('string');
      expect(flattenStyle(b).paddingVertical).toBeGreaterThanOrEqual(12);
    }
    const title = hostTexts(tree).find((t) => textOf(t) === EXACT.title);
    expect(title?.props.accessibilityRole).toBe('header');
  });

  it('no colour literal: every colour on screen comes from this face\'s palette', () => {
    forceFace('dark');
    const { tree } = render();
    press(tree, 'disconnect-spotify');
    const palette = new Set(JSON.stringify(colors.dark).match(/#[0-9A-Fa-f]{6}/g));
    for (const n of tree.root.findAll((x) => typeof x.type === 'string')) {
      const s = flattenStyle(n);
      for (const k of ['color', 'backgroundColor', 'borderColor']) {
        if (s[k] && s[k] !== 'transparent') expect(palette.has(s[k])).toBe(true);
      }
    }
  });
});
