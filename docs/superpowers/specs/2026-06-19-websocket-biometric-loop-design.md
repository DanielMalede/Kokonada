# Design: Live Biometric WebSocket Loop

**Date:** 2026-06-19
**Scope:** Backend WebSocket server + authenticated biometric event loop with 60-second debounce-to-recalibration state machine.

---

## 1. Context & Goal

The backend already has a complete HTTP foundation: Express 5, JWT auth middleware (cookie + Bearer), encrypted wearable tokens, and the `normalize()` adapter that maps Garmin / Apple Health / Suunto readings into a unified `{ heartRate, activity, recordedAt, source }` schema.

The goal of this feature is to add a persistent, authenticated WebSocket layer on top of the existing Express server so that:

1. The React frontend receives live biometric updates to drive the emotion-circle UI indicators.
2. The backend can detect a **sustained** physiological change (heart rate delta > 10 BPM held for >60 seconds) and emit a `playlist_recalibration` event — without hammering the Spotify/YouTube APIs.

---

## 2. Chosen Approach: Approach B — Two-File Socket Layer

The socket layer lives in `backend/app/sockets/` and consists of exactly two files:

| File | Responsibility |
|---|---|
| `sockets/index.js` | Socket.io server factory; attaches to the HTTP server; runs JWT auth middleware on every `connection` |
| `sockets/biometricHandler.js` | Registers biometric event handlers for an authenticated socket; owns the per-user 60-second debounce state machine |

This mirrors the existing `routes/` + `middleware/` pattern and keeps each file independently testable.

`app/index.js` receives a single, minimal change: `app.listen()` is replaced by an explicit `http.createServer(app)` so the socket server can share the same TCP port.

---

## 3. Event Schema

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `biometric_push` | `{ source: string, raw: object }` | Wearable bridge sends a raw reading from any supported source. Server normalizes it via the existing `adapter.normalize()` |
| `emotion_update` | `{ taps: [{x: number, y: number}] }` | Multi-tap emotion-circle coordinates. Stored on socket state; included in recalibration payload |
| `track_skipped` | `{ trackId: string }` | Recorded per-socket. Two consecutive skips trigger an immediate `playlist_recalibration` bypassing the 60s timer |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `biometric_ack` | `{ normalized: NormalizedReading }` | Echoes the normalized reading back so the UI can update live indicators (HR display, activity emoji) immediately |
| `recalibration_pending` | `{ delta: number, secondsRemaining: number }` | A sustained change has been detected. Countdown has started. The UI can show a "Recalibrating in 60s…" indicator |
| `recalibration_cancelled` | `{ reason: string }` | The HR returned to baseline before the 60s elapsed. Timer was cancelled. |
| `playlist_recalibration` | `{ heartRate: number, activity: string, emotionTaps: array, trigger: string }` | Confirmed sustained change (or double-skip). The frontend / AI engine should fetch a new playlist. `trigger` is `"biometric"` or `"skip_loop"` |
| `connection_error` | `{ message: string }` | Auth failure or unrecoverable protocol error. Client should display error and re-authenticate |

---

## 4. Authentication on the WebSocket Handshake

Socket.io middleware runs on every `connection` event, before any event handlers fire:

1. Extract JWT from `socket.handshake.auth.token` (native mobile) OR from the `cookie` header (web/PWA) — mirrors the existing HTTP auth middleware.
2. Call `verifyToken()` from `utils/jwt.js`.
3. Load the user from MongoDB (excluding encrypted token fields, same `select()` projection as HTTP auth).
4. On failure: call `next(new Error('unauthorized'))` — Socket.io disconnects the socket immediately.
5. On success: set `socket.data.user = user`, then join room `user:<userId>`. The room enables server-push to all devices belonging to the same account.

---

## 5. The 60-Second Debounce State Machine

State is stored in a module-level `Map<userId, DebounceState>` inside `biometricHandler.js`. This is ephemeral in-memory state — no Redis needed for the timer itself.

```
interface DebounceState {
  stableHR: number;          // last confirmed baseline
  pendingHR: number | null;  // HR that triggered the timer
  timer: NodeJS.Timeout | null;
  consecutiveSkips: number;
}
```

**Per-push logic:**

```
receive biometric_push
  │
  ├─ normalize(source, raw)  →  emit biometric_ack
  │
  ├─ delta = abs(normalized.heartRate - stableHR)
  │
  ├─ delta < 10 BPM?
  │    └─ update stableHR = normalized.heartRate
  │       clear any running timer  →  emit recalibration_cancelled (if timer was running)
  │
  └─ delta >= 10 BPM?
       ├─ timer already running?  →  do nothing (let it run)
       │
       └─ no timer?
            start 60s timer:
              pendingHR = normalized.heartRate
              emit recalibration_pending { delta, secondsRemaining: 60 }
              
              on timer fire:
                current HR still >= 10 BPM delta from stableHR?
                  YES → stableHR = pendingHR
                         emit playlist_recalibration { trigger: "biometric", ... }
                  NO  → emit recalibration_cancelled { reason: "change_reverted" }
                clear timer + pendingHR
```

**Skip-loop bypass:**

```
receive track_skipped
  consecutiveSkips++
  if consecutiveSkips >= 2:
    clear any running debounce timer
    emit playlist_recalibration { trigger: "skip_loop", ... }
    consecutiveSkips = 0
  
receive biometric_ack or any non-skip event:
  consecutiveSkips = 0  (skips must be consecutive)
```

---

## 6. Edge Cases & Guardrails

| Scenario | Handling |
|---|---|
| Client disconnects mid-timer | `socket.on('disconnect')` clears the timer and deletes the `DebounceState` entry from the Map |
| Same user connected on two devices | Both sockets join room `user:<userId>`. Both receive all server→client events. The debounce Map is keyed by `userId`, so the timer is shared — one recalibration regardless of how many devices push data |
| Malformed `raw` payload | `adapter.normalize()` throws; catch → emit `connection_error` with the message, do not disconnect (client can retry with correct payload) |
| Unknown wearable source | `normalize()` throws `Unknown wearable source: X`; same catch path as above |
| Initial connection (no stableHR yet) | `stableHR` initialises to `normalized.heartRate` of the first push received; no recalibration fires on connection |

---

## 7. Security Considerations

- The socket auth middleware reuses `verifyToken()` — the same JWT validation as the HTTP layer. No weaker token handling.
- Wearable `raw` payloads are passed directly to `normalize()`. The adapter is the validation boundary; any unknown field is ignored.
- The in-memory debounce Map cannot be used as a DoS vector from the client — the timer is controlled server-side; the client merely sends readings.
- CORS on Socket.io is locked to `process.env.FRONTEND_URL` (same origin as Express CORS).

---

## 8. Files Affected

| File | Action |
|---|---|
| `backend/app/index.js` | Refactor `app.listen()` → `http.createServer(app)` + attach socket server |
| `backend/app/sockets/index.js` | **New** — Socket.io server factory + auth middleware |
| `backend/app/sockets/biometricHandler.js` | **New** — biometric events + 60s debounce state machine |
| `backend/tests/websocket.test.js` | **New** — integration tests for auth rejection, biometric_ack, debounce logic, skip loop |

---

## 9. Out of Scope

- The AI playlist generation logic (Phase 5 in PLAN.md) — this design fires the `playlist_recalibration` event; the handler that calls the LLM is a separate concern.
- Redis pub/sub for horizontal scaling — the in-memory Map is correct for a single-node deployment; Redis adapter is a later concern.
- Frontend React/Redux wiring — separate frontend task.
