**H1 design direction (Track H, interim fix on the v1 app)**

Verdict: the design is set and the developer can start building. SHIP depends on the device evidence in section 8. This covers placement and treatment only. The final wording for every string belongs to `regulatory-researcher`.

## 1. One shared primitive: `LegalNote`

To stop the three surfaces drifting apart, build one small component and use it everywhere. A suggested path is `mobile/KokonadaHealth/src/design/system/LegalNote.tsx`, exported from `system/index.ts`.

- **API:** `lines: readonly string[]` only. It takes no `style`, `color` or `tone` prop. Callers wrap it in their own View for width and margin. The component owns every colour and type value, so no caller can tint it.
- **Band:** `backgroundColor: textScrimFill(c, name)` from `useTheme()`, the existing AA-proven scrim. `paddingVertical: space.sm`, `paddingHorizontal: space.lg`, `borderRadius: radius.md`. This matches the existing `genesisStatusScrim` and `errorRow` geometry.
  - No border, no hairline, no elevation (e0).
  - No icon: no info or warning glyph.
  - No close button, not tappable, not a Pressable.
  - `pointerEvents` stays at its default. No ancestor may set `pointerEvents="none"`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"` or `accessibilityLiveRegion`.
- **Text:** one `<Text>` node per line. Never split a line into fragments, so the two AI sentences stay in one node.
  - Style: `fontSize: type.size.body`, `fontWeight: type.weight.regular`, `lineHeight: type.size.body * type.leading.normal`, `letterSpacing: type.tracking.body`, `color: c.content.secondary`, `textAlign: 'center'`.
  - Lines are separated by `space.sm`.
  - Body size and `content.secondary` are the UI-005 minimum. Do not go below either.
- **Font scaling:** `allowFontScaling` stays on. Never set `numberOfLines`, `adjustsFontSizeToFit`, or `maxFontSizeMultiplier` below 2. There is no global cap today, so keep it that way.
- **Motion and haptics:** none. No fade-in, breathing, parallax, skeleton pulse or haptic. Reduced motion looks the same because nothing moves.
- **Contrast:** I computed `content.secondary` over the scrim with the worst blob at full strength (the worst case):
  - Day, over violet: about 8.8:1.
  - Nocturne, over gold: about 10:1.
  - Add an explicit pin to `src/design/__tests__/auroraSurfaces.test.ts`: `content.secondary` must be at least `AA_NORMAL` over `scrimOverBlob` and `glassOverScrim` for every blob in both themes. Today it only passes by sitting between `primary` and `muted`.
- **Never tinted:** no value derived from emotion may reach any prop of the band. That rules out `emotionAccent`, `accentInk`, `focalColor`, `ctaStops` and the Pulse wash. The ambient field bleeding faintly through the 0.88/0.9 scrim is the same for every text cluster and is acceptable.

## 2. Text constants: one exported constant per string, final wording from `regulatory-researcher`

| Constant | Current working text | What to decide |
|---|---|---|
| `AI_DISCLOSURE` | UI-005 invariant: "An AI system infers your emotional state here. It is a machine's reading, not a person's — and it can be wrong." | TASKS.md:240 uses an em dash. The copy rulebook in r_regulatory.md:104 uses a comma. Regulatory picks one and the pin locks it. |
| `MEDICAL_DISCLAIMER` | "Kokonada is not a medical device and does not diagnose, treat, cure, or prevent any medical condition." This mirrors the store line (compliance item A5), so there is one claim everywhere. | Regulatory confirms the in-app echo required by compliance item C5(b). |
| `STATE_LABEL_HEIGHTENED` | "Heightened" replaces 'High-Stress / Pre-Panic'. It describes energy, not a condition, and avoids "stress", which is open question Q4. The safe-list alternative is "Activated". I don't recommend "Highly Activated" because it is too close to "Morning Activation". | Regulatory Q4. |
| `STATE_LABEL_FALLBACK` | "Mixed Signals". This is the fallback if the deny-list catches a label (section 5). | Regulatory. |
| `STATE_LABEL_BALANCED` | "Balanced". It lifts the existing `REMAP` value into a constant. | none |

Show the full `AI_DISCLOSURE` everywhere. Do not ship a short form:
- The second sentence carries the "it can be wrong" honesty, and UI-005 forbids softening.
- A collapsed or tap-to-reveal notice is exactly the "easily overlooked" failure in Guidelines points 141-144.
- A "show once, then collapse" variant would need a persisted seen-flag. That brings back the per-device bug class from MB-009.

**Where the long form lives:** it is not reachable from these three surfaces in H1. No "Learn more" link and no expand control.
- The scope-framed long variant goes on the ConsentSheet. It ships later with counsel's copy and the one consent-version bump.
- The per-read list of inputs goes on the Receipt (Now Playing), written by the server, also later.
- If regulatory later lengthens the three-surface text, it replaces the constant and stays inline. The layout below already allows for it.

## 3. Generate (`src/experience/generate/GenerateScreen.tsx`)

- **Position:** in the ScrollView content, directly after the hero View (`styles.hero`, which holds the wheel and aura) and directly before the Live/Manual toggle Pressable. It is a sibling at ScrollView level, never inside the hero, so it is never under the hero's `pointerEvents="none"` overlays.
  - It comes later in the tree than the hero, so it draws on top of the aura halo. The halo overspills about 0.3 of the wheel size below the hero.
- **Wrapper:** `marginTop: space.lg`, `width: fullSize` (the existing wheel diameter). Use `fullSize`, not `wheelSize`, so the band does not shrink to the small ring while typing.
  - The toggle keeps its existing `gap16`, so the rhythm is: hero, 16, notice, 16, toggle.
- **Always shown:** in idle, with taps, while typing (it stays in the layout; do not put it inside the `!typing` branch), with the list open, and with the error row showing. The Genesis takeover is modal and covers it; don't add the notice to Genesis.
- **Above the fold:**
  - At font scale 1.0 on the S22+, the notice sits at about 420 to 505dp, well above the tab bar.
  - At 2.0 on a compact 360x640dp screen, its first line must be on screen at scroll 0, and it must never be cut off.
- **Reading order:** wheel, then the quadrant list affordance, then the notice as one sentence, then the Live toggle.

## 4. Onboarding (`src/onboarding/OnboardingScreen.tsx`)

- **Position:** in the persistent bottom chrome (`:137`), between the pager dots and the Continue/Begin CTA. It is not on a panel.
  - It is identical on all three panels, it does not move with swipe or parallax, and the Begin fade (`beginFade`) does not apply to it.
  - It sits outside the `AnimatedPressable`.
- **Spacing:** the dots keep `marginBottom: space.xl` (unchanged). The notice wrapper gets `width: '100%'`, `maxWidth: CTA_MAX_WIDTH` (the existing constant, so its edges line up with the CTA) and `marginBottom: space.lg`. That puts the notice closer to the CTA and further from the dots.
- **Layout change (required):** the chrome is `position: 'absolute'` over the pager today. With the notice added, there is only about 16dp between the band and the last panel title at font scale 1.0, and they overlap at 1.3 and above. Legal text must never sit over or under panel copy.
  - Fix: take the chrome out of absolute positioning and let it flow as a normal sibling below the pager, with the pager at `flex: 1`. No onboarding test pins the absolute chrome.
  - Fallback if something blocks this: keep it absolute and add the chrome's `onLayout` height as bottom padding on the panels.
  - Acceptance: no panel-copy pixel under the band at font scale 1.0 or 2.0.
- **Should do:** move the Skip Pressable after the chrome in the JSX. It is absolutely positioned, so nothing moves visually, but TalkBack then reads the notice before either exit.
- **Known issue, not blocking (P2):** at font scale 2.0 the third panel title may clip inside its copy zone. This problem already exists; the redesign's Onboarding page (P10) owns it.

## 5. Pulse (`src/experience/pulse/PulseScreen.tsx`) and the display map

**Header, the state headline:** the existing `StateCard` headline (`:198`) is unchanged: `accessibilityRole="header"`, subheading, semibold, `content.primary`. It now renders the display label from the map.

**Display map (`statusLabels.ts`):**
- Normalise the raw label before lookup: trim, lowercase, and collapse spaces around "/".
- Map `'high-stress / pre-panic'` to `STATE_LABEL_HEIGHTENED`.
- Add a deny-list safety net. Any unmapped label that matches `/panic|anxi|depress|burnout|disorder|symptom|risk|attack|crisis|alarm|danger|predict|stress/i` becomes `STATE_LABEL_FALLBACK`. It is never shown raw and never falls through the capital-letter pass-through.
- `statusQuadrant` keeps reading the raw backend key. The wash stays `intense` (violet), and `pulsePresentation.test.ts:118` stays green.
- The raw label must never reach any `accessibilityLabel`.
- **Flag for regulatory:** "Exhausted Commute" is a judgement on the body. It is not mapped in H1 unless regulatory rules to map it (safe pattern: "low-energy").

**Legal band:** one `LegalNote` with `lines=[AI_DISCLOSURE, MEDICAL_DISCLAIMER]`, in that order.
- **Position:** the last child of the ScrollView content, directly after the `StateCard`, `marginTop: space.md`. The gap is tighter than the stack's `xl` so the card and notice read as one unit. It spans the full width of the stack.
- **Why below the card rather than above:** screen-reader users who jump by heading land on the headline, and the next swipes read confidence, then the notice, then the disclaimer. A notice placed above the card would be skipped.
- **Why not inside the card:** the card wears the wash tinted by the inferred state, and legal copy must never sit on that tint.
- **Shown in every Pulse state:**
  - Loading skeleton: after the `Skeleton.Group`, never inside it, because the busy region would swallow it. It must stay static and never breathe with the skeleton.
  - Empty state: after `EmptyState`, `marginTop: space.xl`, outside its live region and fade.
  - Loaded with a state label.
  - Loaded with no label (the placeholder and Connect link).
- **Hierarchy:** the headline still dominates through colour, weight and the raised, elevated card. The band is quiet: secondary colour, regular weight, faint scrim.

## 6. Forbidden on all three surfaces

- Accent-tinted ink or fill.
- `state.warning` or `state.danger`.
- Bold, uppercase or italic text.
- A warning or info glyph.
- A banner, toast or modal treatment.
- Anything dismissible.
- Animation or haptics.
- `numberOfLines`.
- Rendering it conditionally on theme, emotion, consent or seen-state.

## 7. Tests the design contract needs (pins for the developer)

1. Exact-string pins on each constant. Each surface renders the constant through `getByText`: Generate, Onboarding on every panel, and Pulse in all four states.
2. No ancestor sets `pointerEvents="none"` or hides the node from accessibility. No `numberOfLines`, `adjustsFontSizeToFit` or `maxFontSizeMultiplier` on the node.
3. Style equals `content.secondary` on `textScrimFill(c, name)` in both themes.
4. The notice's style is deep-equal with taps in the intense corner and in the joyful corner, and on Pulse with the intense status and a calm status. This is the "never tinted" pin.
5. `friendlyStatus` over every backend label, plus case and spacing variants, never contains a deny-list term. `'High-Stress / Pre-Panic'` returns `STATE_LABEL_HEIGHTENED`.
6. The Pulse header's accessible name equals the display label.

QA note: "not inside a ScrollView" can't be a rule, because Generate and Pulse are both ScrollViews. Pin instead:
- Generate: above the fold at scroll 0.
- Pulse: the next sibling after the StateCard.
- Onboarding: outside the pager.

## 8. Device evidence required for SHIP

Use a release build with Hermes on the S22+, captured in both light and dark. Each capture needs a manifest with the build SHA, device, theme, font scale and motion setting.

**Generate:**
- G1: idle, font scale 1.0, scroll 0.
- G2: idle, font scale 2.0.
- G3: a screen recording of at least 30 s (2 or more field cycles). Extract the frames where the backdrop under the band is lightest (dark theme) and darkest (light theme). Report the pixel-sampled text-to-band contrast; it must be at least 4.5.
- G4: taps in the intense corner vs the joyful corner, side by side. The band must be identical.
- G5: typing, with the keyboard up and the small ring showing.
- G6: list open plus the error row showing.
- G7: reduced motion on.
- G8: TalkBack focus on the notice, with the speech-output log showing one utterance and the order (wheel/list, then notice, then toggle).

**Onboarding:**
- O1: panels 1, 2 and 3 at font scale 1.0.
- O2: mid-swipe between panels 1 and 2 (the notice doesn't move).
- O3: panel 3 at font scale 2.0 (no overlap, CTA reachable).
- O4: panel 3 before Begin has faded in.
- O5: TalkBack reading order.
- O6: reduced motion on.

**Pulse:**
- P1: a synthetic fixture with HRV below 20 ms, so the raw label is 'High-Stress / Pre-Panic'. Scroll to the bottom and show the headline "Heightened" (or the final label), the violet wash, and the band.
- P2: P1 at font scale 2.0 (the one-column grid).
- P3: a calm status. The band must be identical to P1.
- P4: the loading skeleton (band present and static).
- P5: the empty state.
- P6: the no-label placeholder.
- P7: TalkBack jump to the headline, then swipe to confidence, then the AI notice, then the disclaimer.
- P8: a `uiautomator dump` of the P1 screen, grepped for "Panic" and "Stress", with zero hits.

**Every surface:**
- A `uiautomator dump` showing the notice node visible, with text equal to the constant.
- An `npm run lint:design-system` pass showing no new magic numbers. The only values used are tokens plus the existing `fullSize` and `CTA_MAX_WIDTH`.

## 9. Out of scope and routing notes

- Do not touch the ConsentSheet, consent versions, `consent.js`, `consentApi`, Genesis, Now Playing/Receipt, or the tab bar. The tab bar is tinted by the user's own taps, not by an inferred state.
- H2 should add no UI. If a rationale step is needed before the Bluetooth permission prompt, send it to `designer` before any code.
- Open question for regulatory (P2): "here" in the Onboarding chrome reads as "in this app". UI-005 accepted this; the ruling should confirm it.

## Files

- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\generate\GenerateScreen.tsx`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\onboarding\OnboardingScreen.tsx`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\PulseScreen.tsx`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\statusLabels.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\auroraSurfaces.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\__tests__\auroraSurfaces.test.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\tokens.ts`
- `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\design\system\index.ts`