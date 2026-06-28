# Kokonada HR — Garmin Connect IQ watch app

Foreground watch-app that streams live heart rate from a Garmin device to the
Kokonada backend, which turns HR changes into adaptive playlist swaps in the web
app.

## What it does

1. Reads live HR from the optical sensor (`Toybox.Sensor`).
2. Every ~13s, if HR moved enough (or a liveness window elapsed), POSTs it to the
   backend's watch ingest endpoint.
3. Shows current HR + connection status; a button/tap toggles streaming.

It is **foreground-only**: HR streams while the app is open (e.g. during a
listening/workout session) and stops on exit. This is intentional — Connect IQ
background temporal events have a ~5-minute floor, far too slow for responsive
HR-driven playlist swaps.

## Backend contract (already live)

```
POST {backendUrl}/api/integrations/watch/hr
Authorization: Bearer whr_<token>
Content-Type:  application/json

{ "heartRate": 30..230, "activityType": <garmin int>, "ts": "<ISO8601>" }
```

Responses → UI state: `202` OK · `400` bad HR · `401` bad/missing token ·
`409 {live:false}` no open browser session · `429` rate-limited (5 req/60s, so
the min interval is ~12s). The backend only regenerates a playlist on the first
reading or a **≥25 bpm** change, so flat HR is sent sparsely on purpose.

## Project layout

| Path | Purpose |
|------|---------|
| `manifest.xml` | App id, products, `Communications` + `Sensor` permissions |
| `monkey.jungle` | Build config (manifest pointer) |
| `source/KokonadaApp.mc` | `AppBase` entry; owns the `HrStreamer` lifecycle |
| `source/HrStreamer.mc` | Sensor wiring, send-gating timer, `makeWebRequest` POST loop |
| `source/KokonadaView.mc` | Status display (HR, status text, hint) |
| `source/KokonadaDelegate.mc` | Start/stop toggle (SELECT button / tap) |
| `resources/settings/settings.xml` | Phone-side settings (token, backend URL) |
| `resources/settings/properties.xml` | Default property values |
| `resources/strings/strings.xml` | UI strings |
| `resources/drawables/` | Launcher icon |

## Build & run (after the SDK is installed)

1. Open the `watch/` folder in VS Code (Monkey C extension active).
2. Set your developer key: `monkeyC.developerKeyPath` → your `developer_key`.
3. `Ctrl/Cmd-Shift-P` → **Monkey C: Build for Device** or **Run** (F5) → pick a
   device (e.g. fr255) to launch the simulator.
4. In the simulator, set the token: **File → Edit Persistent Storage** (or **App
   Settings**) → paste a real `whr_…` token from the web app's "Set up watch"
   card into `watchToken`. Leave `backendUrl` as the production default (or point
   it at your local backend).
5. Press the device's **START/SELECT** (or tap) to begin streaming.

## First-light verification

- **Contract:** with a valid token and the web app open in a desktop browser →
  status shows `OK (… bpm)` (HTTP 202). Blank/garbage token → `Bad token`.
  Web app closed → `Open Kokonada in browser` (409).
- **Live HR:** use the simulator's HR data source (Data Simulation) to sweep HR;
  a ≥25 bpm jump should trigger a new queued playlist in the web app.
- **Budget:** flat HR should mostly suppress sends; hammering HR changes should
  eventually surface `Rate limited` (429) and back off.

> Note: this skeleton was authored against the SDK API but has **not yet been
> compiled** — expect to resolve a few type/API nits on first build once your
> SDK + device profile are installed.
