# Kokonada HR — Pre-Sideload Checklist

Run every item below in the **Connect IQ Simulator** before copying the .prg
to the physical fēnix. Items marked 🔴 are blockers; 🟡 are important but not
blocking; 🟢 are polish checks.

---

## 0. Build health

| # | Check | How | Pass |
|---|-------|-----|------|
| 0.1 🔴 | Zero compiler errors | F5 → PROBLEMS tab empty | ☐ |
| 0.2 🔴 | Zero type-check warnings | OUTPUT > Monkey C → no warnings | ☐ |
| 0.3 🟡 | Memory at startup < 60 % | Status bar: left number / right number < 0.6 | ☐ |

---

## 1. Watch-App Connectivity — network scenario tests

**Setup:** F5 → enter token via File > Edit Persistent Storage > Application.Properties.
Press START to begin streaming. Then press **MENU** to cycle scenarios.

Each press of MENU advances one scenario and the yellow banner on screen
confirms which is active. The result appears in the status text within 13 s.

| # | Scenario | Expected status text | Pass |
|---|----------|----------------------|------|
| 1.1 🔴 | `[T] 202 OK` | `OK (120 bpm) [T] 202 OK` | ☐ |
| 1.2 🔴 | `[T] 409 No session` | `Open Kokonada in browser` | ☐ |
| 1.3 🔴 | `[T] 401 Bad token` | `Bad token — re-set in app` | ☐ |
| 1.4 🔴 | `[T] 429 Rate limit` | `Rate limited — backing off` then `Backoff Xs` | ☐ |
| 1.5 🟡 | `[T] Net error` | `Phone disconnected` | ☐ |
| 1.6 🟡 | After rate-limit backoff expires (65 s) | Resumes normal sends automatically | ☐ |
| 1.7 🟡 | Press MENU past last scenario | Banner disappears, real network resumes | ☐ |

**Reconnection test (1.8):**
1. Start streaming → confirm `OK` status.
2. In simulator: Settings > Connection Type > set to **No Phone** (simulate BT off).
3. Wait for next tick → status: `Phone disconnected`.
4. Re-enable connection → next tick sends successfully → status: `OK (… bpm)`.
Pass: 🟡 ☐

---

## 2. UI Smoothness

| # | Check | How | Pass |
|---|-------|-----|------|
| 2.1 🔴 | No crash/freeze on rapid START/STOP | Press START and immediately BACK 10× quickly | ☐ |
| 2.2 🟡 | Status text updates every tick | Watch the status line for 30 s — must update each cycle | ☐ |
| 2.3 🟡 | HR number updates on sensor change | Simulation > Activity Data > Load File → play a FIT — number animates | ☐ |
| 2.4 🟢 | No screen flicker during update | Watch for blank/white flash between renders | ☐ |
| 2.5 🟢 | MENU press registers correctly | Banner appears within 1 s of press | ☐ |

---

## 3. Activity Mode Transitions

These validate that the `activityType` field and HR delta gating behave
correctly across state changes.

| # | Check | How | Pass |
|---|-------|-----|------|
| 3.1 🟡 | HR spike scenario triggers send | Activate `[T] HR spike 155` — confirm `Sending 155…` fires within 13 s | ☐ |
| 3.2 🟡 | HR flat scenario suppresses sends | Activate `[T] HR flat 121` — status stays `OK` with no new `Sending…` for 45 s | ☐ |
| 3.3 🟡 | Liveness ping fires after 45 s flat | After 45 s with flat HR: `Sending 121…` appears (liveness window) | ☐ |
| 3.4 🟡 | Stop clears all state | Press STOP → HR shows `--`, status `Stopped`, no further sends | ☐ |
| 3.5 🟡 | Restart after stop works cleanly | STOP then START → streams normally; no stale state | ☐ |
| 3.6 🟢 | Back key during streaming stops, not exits | Press BACK while streaming → `Stopped`, app stays open | ☐ |

---

## 4. Garmin-Specific Checks

### 4a. Memory Profiler

The status bar shows `X/763.6kB` at all times. For a detailed view:

1. Launch the app in the simulator (F5).
2. Observe the left number in the status bar — this is **current heap usage**.
3. Run streaming for 2+ minutes (let 10+ timer ticks fire).
4. **Pass:** the left number must not grow continuously. A flat or stable reading
   means no memory leak. A number climbing each tick = leak in the hot path.

For detailed profiling:
- Simulator menu > **Data Fields** > check there's no runaway data field usage.
- Simulator menu > **adb Connection** > open a console → type `memory` to get
  a heap breakdown.

| # | Check | Target | Pass |
|---|-------|--------|------|
| 4.1 🔴 | Peak RAM at startup | < 40 % of 763.6 kB (< ~300 kB) | ☐ |
| 4.2 🔴 | RAM after 2 min streaming | Not growing tick-over-tick | ☐ |
| 4.3 🔴 | RAM after 5× START/STOP | Same as after first start (no leak on cycle) | ☐ |

### 4b. Battery Optimization

| # | Check | Why it matters | Pass |
|---|-------|----------------|------|
| 4.4 🟡 | Timer interval is 13 s (not < 12 s) | Stays under the backend's 5/min rate limit | ☐ |
| 4.5 🟡 | Sensor subscription released on STOP | Sensor.enableSensorEvents(null) called | Code ☐ |
| 4.6 🟡 | Timer stopped on STOP | _timer.stop() called before null | Code ☐ |
| 4.7 🟢 | No wake in backoff period | `Backoff Xs` shown, no `Sending…` during window | ☐ |

### 4c. Permission Validation

| # | Check | How | Pass |
|---|-------|-----|------|
| 4.8 🔴 | `Communications` permission in manifest | manifest.xml line: `<iq:uses-permission id="Communications"/>` | ☐ |
| 4.9 🔴 | `Sensor` permission in manifest | manifest.xml line: `<iq:uses-permission id="Sensor"/>` | ☐ |
| 4.10 🔴 | `fenix847mm` in manifest products | manifest.xml has `<iq:product id="fenix847mm"/>` | ☐ |
| 4.11 🟡 | `Use Device HTTPS Requirements` enabled | Settings menu in simulator — checkbox must be checked for TLS to fēnix's standard | ☐ |

### 4d. Edge Cases

| # | Check | How | Pass |
|---|-------|-----|------|
| 4.12 🟡 | Token empty on fresh install | Clear token in Properties → START → `Set token in phone app` | ☐ |
| 4.13 🟡 | backendUrl empty | Clear backendUrl → START → `Set token in phone app` | ☐ |
| 4.14 🟡 | Simultaneous in-flight guard | Rapid STOP+START during a send — app must not double-POST | ☐ |

---

## 5. Final pre-sideload gate

All 🔴 items must be ✅ before copying the .prg to the watch.

```
0.1 ☐  0.2 ☐
1.1 ☐  1.2 ☐  1.3 ☐  1.4 ☐
2.1 ☐
4.1 ☐  4.2 ☐  4.3 ☐
4.8 ☐  4.9 ☐  4.10 ☐
```

When all 🔴 boxes are checked:
1. `Ctrl+Shift+P` → **Monkey C: Build for Device** → **fenix8 47mm**
2. Copy `watch/bin/KokonadaHR.prg` → `GARMIN/APPS/` on the watch (USB)
3. Safely eject
4. Garmin Connect Mobile → device → Connect IQ Apps → Kokonada HR → Settings → paste token
5. Open app on watch → START → verify `OK (… bpm)` with real optical HR
