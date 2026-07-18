# Bundled fonts

Drop the display face here and link it:

- `GeneralSans-Semibold.otf` (OFL, Fontshare) — the Kokonada display logotype. Add the
  `OFL.txt` license alongside it.

Then run `npx react-native-asset` (Android auto-links from `react-native.config.js` `assets`;
iOS already lists the file in `Info.plist` `UIAppFonts`). Finally flip
`design/tokens.ts` `type.family.display` from `'System'` to `'GeneralSans-Semibold'` — the
Splash/SignIn wordmarks already reference `typography.family.display`, so they adopt it with
no further screen change.
