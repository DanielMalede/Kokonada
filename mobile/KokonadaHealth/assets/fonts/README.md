# Bundled fonts

AURORA bundles **Manrope** (OFL, the Manrope Project Authors) as the single app-wide face —
display + text, including the "Kokonada" wordmark (weight 600) and headlines (weight 800):

- `Manrope-Regular.ttf` (400)
- `Manrope-Medium.ttf` (500)
- `Manrope-SemiBold.ttf` (600)
- `Manrope-Bold.ttf` (700)
- `Manrope-ExtraBold.ttf` (800)
- `OFL.txt` — the SIL Open Font License 1.1 the faces ship under.

Then run `npx react-native-asset` (Android auto-links from `react-native.config.js` `assets`;
iOS lists each file in `Info.plist` `UIAppFonts`). `design/tokens.ts` `type.family.display` and
`type.family.text` both resolve to `'Manrope'`, so every screen adopts it with no further change.

**Android weight fallback:** if the on-device build mis-selects a weight (RN 0.86 can misresolve
`fontFamily:'Manrope' + fontWeight`) or renders tofu, pin the exact face via
`design/tokens.ts` `fontFace` (e.g. `fontFamily: fontFace.extrabold` → `Manrope-ExtraBold.ttf`).
