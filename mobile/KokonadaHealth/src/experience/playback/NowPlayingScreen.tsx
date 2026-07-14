import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { nowPlayingStore } from './nowPlayingStore';
import { orchestrator } from './playbackServices';
import type { NowPlaying } from './playbackOrchestrator';
import type { QueueTrack } from './playbackQueue';
import { UpNextSheet } from './UpNextSheet';
import { SpotifyAttribution } from '../player/SpotifyAttribution';
import { playerStatusStore } from '../player/playerStatusStore';
import { store } from '../../state/store';
import { emotionAccentFor } from '../../design/emotionAccent';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion } from '../../design/tokens';

// A stable empty snapshot so a closed sheet never hands the sheet a fresh array identity each render.
const NO_TRACKS: QueueTrack[] = [];

// Now Playing — Wave 2.8 "Bioluminescence" full-screen player. The current track and its
// transport, driven entirely by the unit-tested PlaybackOrchestrator. This is a visual
// reskin on the design-token system only; the playback CONTRACT is untouched:
//   • subscribes to nowPlayingStore with a useEffect cleanup (S10-1 no-leak, pinned),
//   • prev→skipPrev, play/pause→togglePlayPause, next→skipNext,
//   • play/pause disabled with no track, and an empty state when nothing is playing.

const ART_SIZE = 300;              // cover maximum on a roomy viewport (no token for a hero cover)
const ART_VIEWPORT_FRACTION = 0.42; // never let the cover eat more than this of the viewport height
const PLAY_SIZE = 72;              // the primary transport affordance

// The one signature, shared with the Auth gate: a single soft cyan bloom that BREATHES
// behind the cover — depth, not neon. Decorative (a11y-hidden) and stilled under reduced
// motion (the breath duration collapses to 0, and the loop is torn down).
function PlaybackAura({ color, reduced, breathMs, size }: { color: string; reduced: boolean; breathMs: number; size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || breathMs <= 0) return; // reduced-motion → a still bloom, no loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, breathMs, t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.55] });
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.aura, { width: size, height: size, backgroundColor: color, transform: [{ scale }], opacity: reduced ? 0.35 : opacity }]}
    />
  );
}

export function NowPlayingScreen() {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const { width, height } = useWindowDimensions();
  // H1: bound the hero cover to the LIVE viewport so it can never overflow the non-scrolling
  // artWrap and occlude the meta/transport rows. Responsive on width AND height — so portrait,
  // landscape, split-screen and small phones all stay legible — capped at the design maximum on
  // roomy screens. flexShrink on the art (below) is the final guarantee if space is still tight.
  const artSize = Math.min(width - space.xl * 2, height * ART_VIEWPORT_FRACTION, ART_SIZE);
  const [state, setState] = useState<NowPlaying & { coverUri: string | null }>({
    track: nowPlayingStore.getState().track,
    isPlaying: nowPlayingStore.getState().isPlaying,
    coverUri: nowPlayingStore.getState().coverUri,
  });

  useEffect(() => {
    const sync = (s: any) => setState({ track: s.track, isPlaying: s.isPlaying, coverUri: s.coverUri });
    sync(nowPlayingStore.getState());
    return nowPlayingStore.subscribe(sync); // cleanup returns the unsubscribe (S10-1)
  }, []);

  // Up-Next sheet: a low-emphasis trigger opens the queue over Now Playing. Live connection drives
  // its soft states; the session accent is chosen ONCE (static per session, never per-track).
  const [upNextVisible, setUpNextVisible] = useState(false);
  const [connection, setConnection] = useState(playerStatusStore.getState().status);
  // L2: re-read the LIVE status on mount before wiring the subscription — a connect/disconnect that
  // lands between the initial render and the effect commit would otherwise be dropped (mirrors the
  // nowPlayingStore effect above, which already syncs current state on mount).
  useEffect(() => {
    setConnection(playerStatusStore.getState().status);
    return playerStatusStore.subscribe((s) => setConnection(s.status));
  }, []);
  // L5 (ACCEPTED): mounted before COLD hydration, taps may be empty → the session quadrant renders
  // `calm` (the brand default). Cosmetic and consistent with the "static per session" accent design.
  const quadrant = useMemo(() => emotionAccentFor(store.getState().emotion.taps), []);

  // L3: snapshot the queue ONCE while the sheet is open (stable identity until it reopens), and keep
  // the jump handler stable — so the sheet's memoized rows aren't churned by unrelated re-renders.
  const queueTracks = useMemo(() => (upNextVisible ? orchestrator.getQueueTracks() : NO_TRACKS), [upNextVisible]);
  const onJump = useCallback((t: QueueTrack) => orchestrator.jumpToId(t.id), []);

  const { track, isPlaying, coverUri } = state;

  // Graceful degradation (L2): a non-null but broken/undecodable cover file must still fall
  // back to the ♪ token placeholder — never a blank panel. The flag is keyed to the current
  // coverUri (resolved from the live App Remote state), so a new track re-attempts its art.
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [coverUri]);
  // B1: gate the cover on TRACK metadata too. coverUri is set on its own channel (the
  // resolver), decoupled from the track, so coverUri!=null && track==null is reachable
  // (foreign playback at boot with an empty queue). The cover's a11y label reads
  // track.title, so a cover with no track would null-deref — show the placeholder instead.
  const showCover = !!coverUri && !coverFailed && !!track;

  // The session discovery accent (static per session — the quadrant is chosen ONCE, above).
  const accent = c.emotionAccent[quadrant];
  // The enriched "why this discovery" branch fires for a DISCOVERY track (recordingKey present)
  // whose backend receipt carries an LLM caption (the witty one-liner). A familiar track, or a
  // discovery track with no caption, gets the quiet pill.
  // Defense-in-depth: treat the caption as present only when it's a non-empty string, so a FUTURE
  // non-sanitized write path can't surface a blank enriched line.
  const caption = typeof track?.receipt?.caption === 'string' && track.receipt.caption.trim() ? track.receipt.caption.trim() : null;
  const isDiscoveryEnriched = !!(track?.recordingKey && caption);

  // discoveryReveal (§2.a): on track-change INTO an enriched discovery track (caption present) the
  // accent border + payload line fade+rise ONCE — elapsed-time driven (Animated.timing), never a per-frame loop
  // and never a perpetual breath (that lane is the PlaybackAura's alone). A rapid next/next/next
  // cancels the in-flight reveal cleanly via the effect cleanup, so it never queues or stutters.
  // L1: a FRESH 0-value per track id (not a shared ref reset after paint). Reset-before-paint —
  // so a discovery→discovery skip renders the new receipt already at opacity 0, never flashing the
  // prior track's end-state for one frame before re-fading. The effect below only .start()s it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional keyed remount: a new value per track id
  const reveal = useMemo(() => new Animated.Value(0), [track?.id]);
  useEffect(() => {
    if (!isDiscoveryEnriched || reduced) return; // reduced motion → no animation (instant swap below)
    const anim = Animated.timing(reveal, {
      toValue: 1,
      duration: motion.duration.slow,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop(); // cancel-on-change — the reveal interrupts instead of stacking
  }, [track?.id, isDiscoveryEnriched, reduced, reveal]);
  // Under reduced motion the treatment renders static (no opacity ramp, no translate) — a true
  // instant swap. Otherwise the border + content fade in and rise a hair on the reveal.
  const revealStyle = reduced
    ? null
    : { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [space.xs, 0] }) }] };

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      {/* Album art — the REAL cover for the CURRENTLY PLAYING track, resolved client-side from
          the live App Remote player state (no Web API). A token-styled bio panel stands in
          whenever coverUri is null (not yet resolved, a non-Spotify track, or a failed fetch).
          The bloom breathes behind it. */}
      <View style={styles.artWrap}>
        <PlaybackAura color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={artSize} />
        <View
          testID="now-playing-art"
          style={[styles.art, elevation.e2, { width: artSize, height: artSize, maxHeight: artSize, backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}
        >
          {showCover ? (
            <Image
              testID="now-playing-cover"
              source={{ uri: coverUri! }}
              resizeMode="cover"
              onError={() => setCoverFailed(true)}
              accessibilityRole="image"
              accessibilityLabel={`Album art for ${track!.title}`}
              style={[styles.cover, { borderRadius: radius.xl }]}
            />
          ) : (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ fontSize: 64, color: c.content.secondary }}
            >
              ♪
            </Text>
          )}
        </View>
      </View>

      <View style={styles.meta}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={{ fontSize: typography.size.title, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading, color: c.content.primary, textAlign: 'center' }}
        >
          {track ? track.title : 'Nothing playing yet'}
        </Text>
        <Text
          numberOfLines={1}
          style={{ marginTop: space.sm, fontSize: typography.size.subheading, color: c.content.secondary, textAlign: 'center' }}
        >
          {track ? track.artist : 'Generate a vibe to start'}
        </Text>

        {/* NP-ATTR (compliance C1/C2): the reusable Spotify attribution + link-back for the live
            Spotify content on this surface. Ordered (Daniel) BETWEEN the metadata and the receipt —
            its own element, hairline-separated and visually distinct — so nothing here can imply
            Spotify authored the pick or bleed into the "why this track" receipt copy below. */}
        {track ? (
          <View testID="now-playing-attribution" style={[styles.attribution, { borderTopColor: c.surface.hairline }]}>
            <SpotifyAttribution />
          </View>
        ) : null}

        {/* Mix-receipt — the honest "why this track", built server-side from real signals. THREE
            branches, ONE node, no error state ever (§2.a):
              • familiar (recordingKey null)      → the quiet pill, exactly as shipped;
              • discovery + caption               → the enriched, accent-outlined treatment;
              • discovery, no caption (flag off)  → graceful fallback to the quiet pill.
            Hidden entirely when the track carries no receipt (e.g. a legacy payload). */}
        {track?.receipt ? (
          isDiscoveryEnriched ? (
            <Animated.View
              testID="now-playing-receipt"
              // accessible: collapse the child Text fragments into ONE a11y element so the crafted
              // "Why this track: …" sentence is announced whole (a bare View is not a single node).
              accessible={true}
              style={[styles.receipt, styles.receiptDiscovery, { backgroundColor: c.surface.raised, borderColor: accent.ink }, revealStyle]}
              accessibilityRole="text"
              // The caption is the announced payload. Detail-parity (M1): the de-emphasized detail
              // <Text> renders alongside, so a screen-reader user must hear it too — append it here.
              accessibilityLabel={`Why this track: New discovery. ${caption}${track.receipt.detail ? ` ${track.receipt.detail}` : ''}`}
            >
              {/* The enriched treatment carries its own id so both branches are test-addressable
                  while the container keeps the shipped now-playing-receipt id. */}
              <View testID="now-playing-discovery" style={styles.discovery}>
                <View style={styles.discoveryHead}>
                  {/* Leading ✦ — the SHAPE signal, so colour is never the sole differentiator. */}
                  <Text
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{ fontSize: typography.size.footnote, color: accent.ink }}
                  >
                    ✦
                  </Text>
                  {/* L4 (per-spec, intentional): the enriched branch hardcodes "New discovery" — the
                      structural gate (recordingKey + caption) is the source of truth here and
                      deliberately wins over receipt.label, so an inconsistent backend payload
                      (label:'Familiar favorite' WITH recordingKey+caption) still reads "New discovery". */}
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.heading, color: c.content.primary }}
                  >
                    New discovery
                  </Text>
                </View>
                {/* The emotional payload — the LLM caption (the witty one-liner) tinted whole in the
                    session accent. Up to ~10 words, so it may wrap to 2 lines then tail-truncate.
                    This line NEVER drops under Dynamic Type.
                    Explicit calm leading (footnote size × leading.normal) so the 2-line accent caption
                    breathes at the app's body rhythm instead of the tighter platform default. Token-sourced. */}
                <Text numberOfLines={2} ellipsizeMode="tail" style={{ fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal, color: accent.ink, fontWeight: typography.weight.medium }}>
                  {caption}
                </Text>
                {/* De-emphasized detail — the FIRST line to drop under Dynamic-Type-large. */}
                {track.receipt.detail ? (
                  <Text numberOfLines={1} style={{ fontSize: typography.size.caption, color: c.content.tertiary }}>
                    {track.receipt.detail}
                  </Text>
                ) : null}
              </View>
            </Animated.View>
          ) : (
            <View
              testID="now-playing-receipt"
              accessible={true} // collapse to one a11y element, mirroring the enriched branch
              style={[styles.receipt, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}
              accessibilityRole="text"
              accessibilityLabel={`Why this track: ${track.receipt.label}${track.receipt.detail ? `, ${track.receipt.detail}` : ''}`}
            >
              <Text
                numberOfLines={1}
                style={{ fontSize: typography.size.caption, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading, color: c.content.primary, textAlign: 'center' }}
              >
                {track.receipt.label}
              </Text>
              {track.receipt.detail ? (
                <Text
                  numberOfLines={1}
                  style={{ marginTop: space.xs, fontSize: typography.size.caption, color: c.content.secondary, textAlign: 'center' }}
                >
                  {track.receipt.detail}
                </Text>
              ) : null}
            </View>
          )
        ) : null}
      </View>

      <View style={styles.transport}>
        <Pressable
          onPress={() => orchestrator.skipPrev()}
          accessibilityRole="button"
          accessibilityLabel="Previous"
          style={styles.sideBtn}
        >
          <Text style={{ fontSize: typography.size.title, color: c.content.secondary }}>⏮</Text>
        </Pressable>

        <Pressable
          onPress={() => orchestrator.togglePlayPause()}
          disabled={!track}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          accessibilityState={{ disabled: !track }}
          style={[styles.playBtn, elevation.e1, { backgroundColor: c.accent.glowInk, opacity: track ? 1 : 0.4 }]}
        >
          <Text style={{ fontSize: typography.size.heading, color: c.content.onAccent }}>{isPlaying ? '❙❙' : '▶'}</Text>
        </Pressable>

        <Pressable
          onPress={() => orchestrator.skipNext()}
          accessibilityRole="button"
          accessibilityLabel="Next"
          style={styles.sideBtn}
        >
          <Text style={{ fontSize: typography.size.title, color: c.content.secondary }}>⏭</Text>
        </Pressable>
      </View>

      {/* Low-emphasis "Up next" affordance (SCREENS §7): tap to open the queue sheet over Now
          Playing. Sits beneath the transport without disturbing the art→meta→transport hierarchy. */}
      <Pressable
        onPress={() => setUpNextVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Up next"
        hitSlop={space.md}
        style={styles.upNext}
      >
        <Text style={{ fontSize: typography.size.heading, color: c.content.secondary }}>⌃</Text>
        <Text style={{ fontSize: typography.size.subheading, color: c.content.secondary }}>Up next</Text>
      </Pressable>

      <UpNextSheet
        visible={upNextVisible}
        onClose={() => setUpNextVisible(false)}
        tracks={queueTracks}
        currentTrackId={track?.id ?? null}
        isPlaying={isPlaying}
        quadrant={quadrant}
        connection={connection}
        onJump={onJump}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: 96, paddingBottom: 56 },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  aura: { position: 'absolute', borderRadius: radius.pill },
  art: { flexShrink: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  meta: { width: '100%', alignItems: 'center', paddingHorizontal: space.md },
  receipt: { marginTop: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  // The enriched treatment reads as a left-aligned block inside the same pill slot (overrides the
  // quiet pill's centering), so the glyph, label, caption and detail share one left edge.
  receiptDiscovery: { alignItems: 'stretch' },
  discovery: { gap: space.xs },
  discoveryHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  attribution: { alignSelf: 'stretch', marginTop: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  transport: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space['3xl'], marginTop: space['2xl'] },
  sideBtn: { padding: space.md, alignItems: 'center', justifyContent: 'center' },
  // ≥44pt a11y tap target via the space['3xl'] (48) token — low-emphasis, centered chevron + label.
  // Extra room below the transport (marginTop space.xl) so the affordance reads as its own zone; the
  // Pressable also carries a hitSlop for a comfortable target beyond the visible bounds.
  upNext: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: space['3xl'], marginTop: space.xl, paddingHorizontal: space.md },
  playBtn: { width: PLAY_SIZE, height: PLAY_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
