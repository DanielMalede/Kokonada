# Bundled fonts

The v2 faces: Heebo for UI text and Bellefair for the voice (`BASE.type.face` in
`src/design/v2/tokens/tokens.generated.ts`), one file for each weight the type scale uses.

| File | Weight | Type roles (the design ledger's §5.4) |
|---|---|---|
| `Heebo-Light.ttf` | 300 | display |
| `Heebo-Regular.ttf` | 400 | body, legal, caption |
| `Heebo-Medium.ttf` | 500 | title, label, nav |
| `Heebo-SemiBold.ttf` | 600 | button labels, the active nav item |
| `Bellefair-Regular.ttf` | 400 | voice lines of 24 dp and up, and nothing else (DEC-052) |

Each weight is a family of its own, named by its file. React Native on Android loads
`fonts/<family>.ttf` from the APK's assets and picks a file by normal or bold only, so text asks for
`Heebo-Medium`, never `Heebo` at `fontWeight` 500. A file's name is also its PostScript name, the name
iOS looks a font up by. The Design Lab's faces are this list (`src/design/lab/fonts.ts`).

## Where they come from

Each file is its authors' own, byte for byte. Nothing is subset, converted or instanced, so none is a
Modified Version under the OFL, and no Reserved Font Name question arises (CMP-118).

- **Heebo 3.100.** The static cuts in `fonts/ttf/` of [OdedEzer/heebo](https://github.com/OdedEzer/heebo)
  at commit `76c7d538568d3e6d7f052a12c5675c84430df25f`, the commit google/fonts records as the source of
  `ofl/heebo` (its `METADATA.pb`). google/fonts ships Heebo only as the variable `Heebo[wght].ttf`, and
  React Native on Android draws a variable file at its default instance whatever weight is asked for, so
  300, 500 and 600 need the static cuts.
- **Bellefair 1.003.** `ofl/bellefair/Bellefair-Regular.ttf` of
  [google/fonts](https://github.com/google/fonts) at commit `3f24ccf123f3c50f72b96d3e15704fe629d2df5d`.

Each git blob below is the upstream file's own blob, so `git hash-object` on a fresh download proves the
copy. `src/design/__tests__/fontLicence.test.ts` pins every font file in the app to its SHA-256.

| File | Git blob | SHA-256 |
|---|---|---|
| `Heebo-Light.ttf` | `fca7c6ac2a338ebae8fbd10ddeba9163ce64baa2` | `4766c9d727f9a4fe0c6bdc4032a82eaa2480ca8f3e516095ed8ba14dc6c0aaf7` |
| `Heebo-Regular.ttf` | `625bc4e91b7a48136b3522e8a60775c46a20ebea` | `e9dc1958e6a5aec129ee79f01e9cfb442680b73bf6c72964137daa581a3afd62` |
| `Heebo-Medium.ttf` | `c52da69d8326c1bf76627688ed7a9ff160d9f6ba` | `cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1` |
| `Heebo-SemiBold.ttf` | `b1de31e03e7b94da0cced707bb9658515baa4c18` | `c1ccdb23b62a503aab7277510f994e665e40eea062305f8e87a7616072aadcba` |
| `Bellefair-Regular.ttf` | `593c69bc58c85e27c8baf52b574ff15c8df22979` | `5c0cd4d526e6dfcb189106af6b5e6ec99a54efb6d458dfd61626ce6dc0f03026` |

## Licences

Each family's licence sits beside its files and is named for the family: `OFL-Heebo.txt` and
`OFL-Bellefair.txt`. Each is the SIL Open Font License 1.1 with the family's copyright line
("Copyright 2014 The Heebo Project Authors", "Copyright 2015 The Bellefair Project Authors"), as the
upstream `OFL.txt` ships it; the repository stores its line endings as LF. Neither declares a Reserved
Font Name. Before the fonts ship in a build anyone else installs, the app must show each family's
copyright line and licence to the user (CMP-117, the P14 licences page).

## Not linked into the app

`react-native.config.js` lists this folder for `npx react-native-asset`, and it has not been run.
Running it would copy the fonts into `android/app/src/main/assets/fonts/`, so every release APK would
carry them before the P14 licences page exists (CMP-117), and it would edit the Xcode project and
`Info.plist` (iOS is frozen). The production route is F6's to decide.

The Design Lab's font check (`src/design/lab/fonts.ts`) finds a face only when its file is in the lab
APK's `assets/fonts/`. Until the lab build copies the files there, a lab scene that declares a face is
refused with an ERROR naming the missing file.

## History

Until 2026-09-30 this folder held a display face whose licence, a free-font end-user licence
agreement rather than the OFL, forbids redistributing the font file, beside a copy of that
licence misnamed `OFL.txt`. Both were removed under CMP-120 and UI-013. Git history still holds
them; it was not rewritten.
