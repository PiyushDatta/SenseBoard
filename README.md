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

## Project Structure

- `apps/client`: SenseBoard web UI modules
- `apps/server`: Bun websocket + AI patch API
- `apps/shared`: shared room and DSL types
- `app`: Expo Router entrypoint (`app/index.tsx` uses `apps/client`)

## Local Run

### 1) Install deps

```bash
bun install
```

### 2) Create local env file

`bun run start:web` now requires a local `.env` file.
Preflight runs by default; disable it with `preflight.enabled = false` in `senseboard.config.toml`.

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

If your server is on a custom host/port range, set:

```bash
EXPO_PUBLIC_SERVER_URL=http://<host>:8787 bun run start:web
```

Without `EXPO_PUBLIC_SERVER_URL`, the client auto-discovers local server ports in a short range starting at `8787`.
Override client discovery with:

- `EXPO_PUBLIC_SERVER_PORT` (default `8787`)
- `EXPO_PUBLIC_SERVER_PORT_SPAN` (default `8`)

## Test + Typecheck

```bash
bun run typecheck
bun run test
```

`bun run typecheck` validates both client and server TypeScript projects.

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
2. Server builds prompt context from transcript/chat/context bank + current board state.
3. Provider routing for diagram ops:
   - If `provider = "anthropic"`: `Claude -> Codex CLI`
   - If `provider = "auto"`: `Claude -> Codex CLI -> OpenAI` (OpenAI only if Claude/Codex unavailable)
4. Returned board ops are applied to shared board state and broadcast to room members.

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
