# SenseBoard MVP

Your hang, illustrated live.

SenseBoard is a Bun + Expo (React Native Web) hackathon MVP for live meeting illustration:

- shared room + realtime state sync
- collaborative transcript/chat/context panels
- AI diagram patch engine with constrained JSON DSL
- whiteboard rendering with a lightweight SVG/HTML canvas
- controls: Freeze AI, Pin Diagram, Focus Mode, Regenerate, Undo AI
- theme modes: Auto (system), Light, Dark toggle in join and room top bar
- topic clarity: auto-clear on topic shifts + archived diagram restore
- dual board views: shared main board + per-user personalized board toggle

## Config (TOML)

Server runtime reads `senseboard.config.toml` automatically.

```toml
[server]
port = 8787
port_scan_span = 8

[logging]
level = "debug" # debug | info | warn | error | silent (keep debug on for demo)

[preflight]
enabled = true # set false to skip ai:preflight on bun run start:web

[capture.transcription_chunks]
enabled = true # capture raw mic chunks to disk for debugging/fixtures
directory = "test_recording_data" # repo-local capture folder for replayable fixtures

[personalization]
sqlite_path = "data/senseboard-personalization.sqlite" # per-name personalization store
max_context_lines = 64 # keep latest N context lines per name

[ai]
provider = "auto" # auto | openai | anthropic | codex_cli | deterministic
openai_model = "gpt-4.1-mini"
openai_transcription_model = "whisper-1" # OpenAI-hosted Whisper (no local GPU)
anthropic_model = "claude-3-5-sonnet-20241022"
codex_model = "gpt-5-codex"

[ai.review]
max_revisions = 20
confidence_threshold = 0.98 # range: 0.0 to 1.0
```

Precedence is: `environment variables > senseboard.config.toml > built-in defaults`.
Use `SENSEBOARD_CONFIG` to point to a different TOML file path.
Review env overrides:

- `OPENAI_API_KEY` (required for OpenAI Whisper transcription)
- `OPENAI_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `CODEX_MODEL`
- `AI_REVIEW_MAX_REVISIONS`
- `AI_REVIEW_CONFIDENCE_THRESHOLD`

`capture.transcription_chunks` is TOML-only (no env override).
When enabled, the server stores incoming audio blobs from `/rooms/:id/transcribe` and logs the file path in debug mode.
Recommended layout for replay tests:

- `test_recording_data/valid` for chunks that should transcribe successfully
- `test_recording_data/legacy_invalid` for old malformed chunks used to reproduce failures
- `personalization.sqlite_path` stores per-name personalization context (SQLite)

## Project Structure

- `apps/client`: SenseBoard web UI modules
- `apps/server`: Bun websocket + AI patch API
- `apps/shared`: shared room and DSL types
- `app`: Expo Router entrypoint (`app/index.tsx` uses `apps/client`)
- `prompts`: prompt templates loaded by the main board-ops AI route

## Local Run

### 1) Install deps

```bash
bun install
```

### 2) Create local env file

`bun run start:web` now requires a local `.env` file.
Preflight runs by default; disable it with `preflight.enabled = false` in `senseboard.config.toml`.
Preflight now checks realtime websocket handshake (`client:ack` -> `server:ack`) against a live server.

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3) Run server (terminal 1)

```bash
bun run server
```

Default server URL: `http://localhost:8787`

If port `8787` is in use, the server automatically tries the next ports (`8788`, `8789`, ...).
You can control this with:

- `PORT` (start port, default `8787`)
- `PORT_SCAN_SPAN` (how many ports to try, default `8`)

### 4) Run client web app (terminal 2)

```bash
bun run start:web
```

Open web in browser from Expo output.
Join/create requires a non-empty display name (used as personalization key in MVP).

If your server is on a custom host/port range, set:

```bash
EXPO_PUBLIC_SERVER_URL=http://<host>:8787 bun run start:web
```

Without `EXPO_PUBLIC_SERVER_URL`, the client auto-discovers server ports on the current browser host, then falls back to `localhost`, in a short range starting at `8787`.
Override client discovery with:

- `EXPO_PUBLIC_SERVER_PORT` (default `8787`)
- `EXPO_PUBLIC_SERVER_PORT_SPAN` (default `8`)

## Test + Typecheck

```bash
bun run typecheck
bun run test
```

`bun run typecheck` validates both client and server TypeScript projects.
`bun run test` runs fast local tests only (`apps/**`) and excludes paid integration tests.
Run paid/provider integration checks explicitly with:

```bash
bun run integration_test
```

`integration_test` replays audio fixtures from `test_recording_data` so you can reproduce transcription behavior on real captured chunks.

## AI Flow

### Speech-to-Text (Mic On)
1. Client sends audio to `POST /rooms/:roomId/transcribe`.
2. Server transcription provider chain:
   - `OpenAI Whisper` (primary)
   - `Claude` (fallback)
   - `Codex CLI` (final fallback)
3. If transcription succeeds:
   - transcript chunk is added to room state
   - AI patch scheduling is triggered (debounced)
4. Debounced transcript events enqueue AI patch jobs.

### AI Diagram Generation (Understand Text + Draw)
1. AI patch job runs from server queue.
2. Server loads prompt templates from `prompts/main_ai_board_system_prompt.md`, `prompts/main_ai_board_delta_prompt.md`, and `prompts/senseboard-live-visual-notetaker/SKILL.md`.
3. On startup/first use, server primes a one-time AI prompt session for the board-ops route.
4. Server builds prompt context from transcript/chat/context bank + current board state.
5. Provider routing for diagram ops:
   - If `provider = "anthropic"`: `Claude -> Codex CLI`
   - If `provider = "auto"`: `Claude -> Codex CLI -> OpenAI` (OpenAI only if Claude/Codex unavailable)
6. If model output is empty/non-visual but transcript lines exist, server emits deterministic transcript-based board ops fallback.
7. Returned board ops are applied to shared board state and broadcast to room members.

### Personalized Board Flow
1. Users switch board view with `Main / Personal` toggle in the room status pill.
2. Main board remains shared and always has queue priority.
3. Personalized board runs in a separate lower-priority queue per `(roomId, name)`.
4. Personalized generation waits for main queue drain, then applies user-tailored board ops.
5. User personalization context is stored in SQLite by name and can be updated from chat via `Add to personalization`.
6. Client fetches personalized board via `GET /rooms/:roomId/personal-board?name=<displayName>`.

### Logging
- Transcription routing/fallback logs:
  - prefix: `[Transcription] ...`
- AI routing/fallback logs:
  - prefix: `[AI Router] ...`

### Current Config
- `senseboard.config.toml` currently uses:
  - `provider = "auto"`
- So effective AI drawing flow right now is:
  - `Claude` primary, `Codex CLI` -> OpenAI fallback.
