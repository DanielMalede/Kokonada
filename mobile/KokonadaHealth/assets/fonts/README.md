# Bundled fonts

No font is bundled. The faces in `type.family` (`src/design/tokens.ts`) are platform names:
`'System'` for display and text, `'monospace'` for mono. Every screen reads the family from
there, so no screen names a face of its own.

A font may be added to this folder only under the SIL Open Font License, with the licence's
full text in an `OFL.txt` beside it. `src/design/__tests__/fontLicence.test.ts` fails the build
on a font without that text, on an `OFL.txt` that holds another licence, and on a font embedded
in a document.

To ship one:

1. Add the font file and its `OFL.txt` to this folder.
2. Run `npx react-native-asset`. Android copies the font to `android/app/src/main/assets/fonts/`;
   iOS adds it to the Xcode project's resources and to `Info.plist` `UIAppFonts`.
3. Point `type.family` in `src/design/tokens.ts` at the font's name.

Until 2026-09-30 this folder held a display face whose licence, a free-font end-user licence
agreement rather than the OFL, forbids redistributing the font file, beside a copy of that
licence misnamed `OFL.txt`. Both were removed under CMP-120 and UI-013. Git history still holds
them; it was not rewritten.
