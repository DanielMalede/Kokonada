# Google sign-in button: Google's pre-approved images

**Source:** Google Identity, "Sign in with Google branding guidelines" (https://developers.google.com/identity/branding-guidelines, updated 2026-07-07), section "Download Pre-Approved Brand Icons".

**Archive URL:** https://developers.google.com/static/identity/images/signin-assets.zip

**Downloaded:** 2026-09-30 (08:46 UTC)

**Archive SHA-256:** `ba884069e12093b06bcfd776915081254a7c95094b80d50be2c5dc6bac1c1da1`

**Set used:** Android + Web, PNG, `Show text=Yes`, `Shape=Pill`. The Light file goes on the light face, and the Dark file on the dark face. The shape is the designer's call; the archive's `Shape=Square` files are the alternative.

**Size:** the @1x file is 180×40. The @2x and @3x files are exact multiples of it. The padding is part of the image.

| Shipped file | Archive path | SHA-256 |
|---|---|---|
| `google_signin_pill_light.png` | `Android + Web/PNG @1x/Light/Theme=Light, Show text=Yes, Shape=Pill, Platform=Android+Web.png` | `59f49a157cd98021d0b4e443f2decbee986a684f330897e378d8ab3769d06253` |
| `google_signin_pill_light@2x.png` | `Android + Web/PNG @2x/Light/Theme=Light, Show text=Yes, Shape=Pill, Platform=Android+Web@2x.png` | `86c7955ee72f3635dc4e1415ac6e10035ca0bb1319245c8e1b441ce1cb5f6981` |
| `google_signin_pill_light@3x.png` | `Android + Web/PNG @3x/Light/Theme=Light, Show text=Yes, Shape=Pill, Platform=Android+Web@3x.png` | `1785e04475553fcec1b63524af33ebfde36ff422008c371589a014c03bf224a4` |
| `google_signin_pill_dark.png` | `Android + Web/PNG @1x/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web.png` | `23b2cceb7831bb576ad2738119191d2fd41ea650265f2034e4ef4cceda7ca904` |
| `google_signin_pill_dark@2x.png` | `Android + Web/PNG @2x/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web@2x.png` | `e0289ad5a31e65af63e385a89457cf3b2405d3a6dda2df6119778b9afdb74bae` |
| `google_signin_pill_dark@3x.png` | `Android + Web/PNG @3x/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web@3x.png` | `c2170246da7db96313062aba5e8e39b15431b2e2fd202c563a81c498f8b2b1f8` |

`src/auth/__tests__/googleBrandAssets.test.ts` recomputes every hash in this table on each CI run.

**Words drawn:** "Sign in with Google"

The accessible name is the same.

The images are in English only, until F7 (DEC-051).

**The rules, quoted from the guidelines above:**

1. "You can scale the button as needed for different devices and screen sizes, but you must preserve the aspect ratio so that the Google logo is not stretched."
2. "Regardless of the text, you can't change the size or color of the Google "G" logo. It must be the standard color version (the standard color gradient super G logo) and appear on a white background."
3. "The Sign in with Google button should be displayed at least as prominently as other third party sign-in options. For example, buttons should be approximately the same size and have similar visual weight."

**Colour modes, quoted from the same page (Last updated 2026-07-07 UTC):**

- Color: "The button must always include the standard color for the Google "G"." The page's table defines the Dark theme as "Fill: #131314", "Stroke: #8E918F | 1px | inside".
- Do: "Use the Google brand color for Google icon for dark, light, and neutral modes."
- Do: "Choose the button in the right color mode for accessibility and equal prominence."
- Don't: "Put the standard color Google "G" icon on a colored background other than light, dark, or neutral."

The Dark file is Google's own Dark theme, unmodified; rule 2 governs a G you build yourself.

Do not edit, crop, re-pad, recolour, tint, dim, mirror or re-export these files. Replace only with a newer download from the same archive and update this file. Google and the Google "G" logo are trademarks of Google LLC.
