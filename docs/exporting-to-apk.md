# Exporting Kokonada to an Android APK (PWABuilder route)

The frontend is now an installable PWA, which lets [PWABuilder](https://www.pwabuilder.com)
generate a real, signed Android package **in the cloud — no Android SDK or Android
Studio needed locally**.

## What was set up (already done)
- `vite-plugin-pwa` generates `manifest.webmanifest` + a Workbox service worker on build.
- App icons (192, 512, maskable, apple-touch, favicon) in `frontend/public/`,
  regenerate anytime with `npm run gen:icons`.
- PWA meta tags in `frontend/index.html`.

## Step 1 — Deploy the PWA to Vercel
PWABuilder reads your **live HTTPS URL**, so the PWA must be deployed first.

```bash
git add frontend
git commit -m "feat: make frontend an installable PWA for APK export"
git push        # Vercel auto-builds and deploys
```

After the deploy finishes, sanity-check that these are live (open in a browser):
- `https://<your-vercel-domain>/manifest.webmanifest`  → should return JSON
- `https://<your-vercel-domain>/sw.js`                 → should return JS

## Step 2 — Generate the APK on PWABuilder
1. Go to **https://www.pwabuilder.com**.
2. Paste your Vercel URL and click **Start**. It scores the manifest / service
   worker (should be green now).
3. Click **Package For Stores → Android**.
4. Choose **Google Play** package type (recommended) or "Other" for a plain APK.
   - It produces a **signed `.apk`** (sideload/testing) **and** an `.aab` (Play Store).
5. Click **Download**. You get a zip containing the package + a `signing.keystore`
   and `signing-key-info.txt`.

## Step 3 — Keep the signing key safe ⚠️
The downloaded `signing.keystore` / key info is what identifies your app. **Back it
up.** If you ever publish updates (to the Play Store or as new APKs), you must sign
them with the *same* key or Android will refuse to install the update.

## Step 4 — Install it
- **Sideload (quick test):** copy the `.apk` to an Android phone, tap it, and allow
  "Install unknown apps" for your file manager / browser when prompted.
- **Play Store:** upload the `.aab` in the Google Play Console (requires a Play
  developer account, one-time $25).

---

## Important caveats
- **Login may not work inside the packaged app yet.** Google/Facebook OAuth and the
  `kokonada_token` cookie are already fragile cross-domain (Vercel ↔ Railway). Inside
  the app's WebView the origin differs again, so cookies/redirects can break. If sign-in
  fails in the APK, the fix is on the auth side (cookie `SameSite`/domain, OAuth
  redirect URIs), not the packaging. Add the app's launch origin to your Google/Facebook
  OAuth "Authorized redirect URIs" if you hit redirect errors.
- This is a **WebView wrapper** of the deployed site — it always loads the latest
  deploy, so you don't rebuild the APK for content changes, only for icon/name/manifest
  changes.
