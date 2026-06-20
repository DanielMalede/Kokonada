# PLAN: AI-Driven Biometric Music Application

## 0. Persona & Development Mindset
**Act as a Senior Full-Stack App Developer, System Architect, and Security Expert.** Throughout the development of this project, you must strictly adhere to the following principles:
* **Zero-Trust Security:** Assume APIs will be abused, tokens can be compromised, and connections will be intercepted. Implement robust token encryption (at rest and in transit), sanitize all LLM inputs, ensure no PII is sent to external AI providers, and use HTTP-only cookies for client auth.
* **Edge-Case First:** Before writing any feature, account for network failures (offline states), hardware sensor dropouts, API rate limits (HTTP 429), and conflicting state inputs. Always write graceful fallbacks.
* **Resilient Frontend:** Treat high-frequency WebSocket data (live heart rate) as a performance hazard. Optimize React renders and Redux state updates to prevent UI freezing and battery drain.
* **Bulletproof Backend:** Implement strict error handling, timeouts, debouncing, and thorough logging for all AI and 3rd-party API calls.

## 1. System Overview & Tech Stack
A dynamic, AI-orchestrated music platform that generates and adjusts playlists in real-time based on the user's explicit emotional state (via UI) and implicit physiological state (via smartwatch biometrics).
* **Frontend:** React, Redux (crucial for rapid state management of multi-tap coordinates and live biometrics).
* **Backend:** Python (FastAPI/Flask) or Node.js.
* **Database:** MongoDB (flexible schema for user profiles, biometric logs, and auth tokens).
* **AI Engine:** Integration with an LLM Gemini flash 3.5 for prompt expansion and playlist curation.
* **Version Control:** Git.

## 2. User Flow & Core Architecture

### Phase 1: Identity & Authentication (The Foundation)
* **SSO Login:** User downloads the app and authenticates via Google, Apple, or Facebook.
* **Profile Creation:** A master `User Entity` is created in MongoDB.

### Phase 2: 3rd-Party Integrations
* **Music OAuth:** User connects their Spotify or YouTube Music account.
* **Health OAuth / Local Bridge:** User connects their wearable data provider (Garmin Connect API, Apple HealthKit locally, Suunto Webhooks).
* **Token Security:** All access tokens must be encrypted in MongoDB.
* **OS Background Execution:** The app must rigorously manage background execution states. It requires specific `UIBackgroundModes` (iOS) or `Foreground Services` (Android) declarations to maintain the live WebSocket connection to the smartwatch and process audio cues without the OS killing the process to save battery when the screen is locked.

### Phase 3: AI Profiling (Initialization)
* **Musical DNA:** The AI analyzes listening history and extracts audio features (Acousticness, Energy, Danceability) to build a baseline musical profile.
* **Medical Baseline:** The AI analyzes historical heart rate and activity logs to establish personal resting HR and target exertion zones.

### Phase 4: The Comprehensive Medical & Physiological Profile (`MedicalProfile`)
Before the AI can make recommendations, the backend must construct and continuously update a holistic `MedicalProfile` for each user. This phase acts as a clinical data processor, pulling the full spectrum of telemetry from the connected wearable device to establish deep contextual awareness.

**The 5 Pillars of Physiological Processing:**
1. **Cardiovascular & Nervous System:** Monitoring Live HR vs. Resting HR, and Heart Rate Variability (HRV). This is crucial for instantly detecting physiological stress (low HRV) versus parasympathetic recovery (high HRV).
2. **Respiratory Metrics:** Tracking Live Respiration Rate (breaths per minute) and SpO2 (Blood Oxygen) to identify panic attacks, hyperventilation, or extreme physical exertion.
3. **Kinematics & Motion:** Analyzing Steps per minute, accelerometer variance, and GPS velocity to determine the exact physical activity (e.g., running vs. driving).
4. **Sleep & Recovery State:** Aggregating the previous night's Sleep Stages (REM, Deep, Light) and overall Daily Readiness/Body Battery. Waking up from Deep Sleep requires a drastically different acoustic intervention than waking from Light Sleep.
5. **Temporal & Device Context:** Logging screen state, Bluetooth audio output, and Time of Day to complete the environmental picture.

**Routine & Medical Detection Output:**
This phase processes the raw data and outputs a consolidated "State Vector" (e.g., `status: "High-Stress / Pre-Panic"`, `status: "Exhausted Commute"`, or `status: "Peak Athletic Performance"`). This highly accurate vector is what will ultimately be fed into the AI Recommendation Engine.

### Phase 5: Core UI (The Emotion Interface)
* **Multi-Tap Emotion Circle:** Instead of a single-point joystick, the interface features a circular 2D emotion map where users can place 2 to 3 distinct "taps". This captures complex, mixed emotions (e.g., one tap between "Happy" and "Chill", and a second tap between "Stressed" and "Angry"). The React frontend will consolidate these multiple (x,y) coordinates into a single multi-dimensional array to feed the LLM a much richer psychological state.
* **Accessibility (a11y):** The Emotion Circle must be fully accessible. Implement color-blind friendly UI modes and ensure there are alternative text-based or list-based selectors for users who cannot interact with a precision 2D graphical map.
* **Live Activity Indicators:** Emoji selectors that auto-highlight based on live biometrics (e.g., HR 145 triggers "Running" emoji).
* **Context Prompt:** A text input for specific requests (e.g., "Need to focus on studying").

### Phase 6: The AI Recommendation Engine
* **Anonymized Payload:** The backend aggregates the consolidated multi-tap coordinates, current HR, activity, and text prompt. PII is strictly stripped, and the payload is sent to the LLM.
* **Prompt Expansion:** The LLM translates the complex human intent + biometrics into exact API parameters (Target BPM, Genre, Valence, Energy).
* **Execution:** Backend fetches the tracks from Spotify/YouTube, builds the playlist, and begins playback.

## 3. Real-Time Sync & Edge Cases Mitigation

### A. The Live Biometric Loop
* **Adapter Pattern:** The backend normalizes different wearable data formats into a single, unified JSON schema.
* **WebSockets:** Live metrics are streamed to the React frontend.
* **Throttling/Debouncing:** To prevent Spotify API rate-limits, the playlist only recalculates if a physiological change (e.g., HR drop) is sustained for >60 seconds.

### B. User Experience Fallbacks
* **Data Conflict Hierarchy:** If active input (Emotion Circle) conflicts with passive data (Heart Rate), the active input takes priority for genre/mood, but passive data influences the BPM.
* **The "Skip" Loop:** If a user skips 2 tracks consecutively, the AI registers negative feedback and immediately recalibrates the active playlist's Energy/Valence parameters.
* **Offline Buffer:** If cellular network drops, the app buffers 5-10 tracks based on the last known state and uses Exponential Backoff to reconnect.
* **AI Timeout Fallback:** If the LLM fails or times out, the backend instantly falls back to a pre-generated, static playlist based on the current activity so the music never stops.

### C. Cost Management & Infrastructure Resilience
* **LLM Caching Layer:** API calls to LLMs are expensive and introduce latency. Implement a Caching mechanism (e.g., Redis or MongoDB lookups). Before calling the LLM for Prompt Expansion, hash the current input state (Biometrics + Multi-Tap coordinates). If a matching state exists from a recent session, return the cached playlist vectors to save tokens.
* **Observability (Sentry):** Integrate robust error monitoring (e.g., Sentry) to catch WebSocket dropouts, API failures, or AI timeouts in real-time.
* **Bluetooth Audio Latency:** The React/Web Audio implementation for crossfading must account for Bluetooth latency and hardware processing delays (specifically optimizing for high-end ANC earbuds like Marshall Motif II A.N.C.) to ensure transitions between drastically different BPM tracks remain perfectly smooth without digital clipping or jarring volume spikes.

## 4. Testing & Devops Strategy
* **Containerization (Docker):** The backend architecture must be fully Dockerized from day one. Create a `docker-compose.yml` to effortlessly spin up the Python server, MongoDB, and Redis cache locally.
* **CI/CD Pipeline:** Set up a basic GitHub Actions workflow to lint the code and automatically run core logic tests on every commit.
* **Biometric Mock Engine:** Create a local testing script to inject fake biometric data (e.g., "simulate HR spike to 160 for 5 mins") directly into the WebSockets to test the React state and AI reaction without physical hardware.
* **Data Deletion:** Implement a strict script for GDPR compliance that wipes a user's entire biometric and musical history upon account deletion.

**Action Item:** Acknowledge this plan. Start by initializing the repository, setting up the strict security environment (dotenv, encryption utilities), and drafting the MongoDB schemas.