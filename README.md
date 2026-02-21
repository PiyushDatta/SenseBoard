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

[ai]
provider = "auto" # auto | openai | codex_cli | deterministic
openai_model = "gpt-4.1-mini"
codex_model = "gpt-5-codex"

[ai.review]
max_revisions = 20
confidence_threshold = 9.8 # accepts 0-1 or 0-10 scale
```

Precedence is: `environment variables > senseboard.config.toml > built-in defaults`.
Use `SENSEBOARD_CONFIG` to point to a different TOML file path.
Review env overrides:

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

### 2) Run server (terminal 1)

```bash
bun run server
```

Default server URL: `http://localhost:8787`

If port `8787` is in use, the server automatically tries the next ports (`8788`, `8789`, ...).
You can control this with:

- `PORT` (start port, default `8787`)
- `PORT_SCAN_SPAN` (how many ports to try, default `8`)

### 3) Run client web app (terminal 2)

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

## MVP Features Implemented

- Room create/join with room code
- Realtime shared room state over websocket
- Canvas with programmatic AI updates (nodes, edges, title, notes, traversal order)
- Transcript panel with mic capture (Web Speech API) + manual fallback input
- Chat panel with `normal` / `correction` / `suggestion`
- Context Bank with `priority`, `scope`, `pinned`
- Visual context hint input ("Currently sharing")
- AI patch loop:
  - scheduled every 5s
  - immediate on correction/context/regenerate
  - server-side rate limit (~2s)
- Control toggles:
  - Freeze AI
  - Pin Diagram
  - Focus Mode (draw box)
  - Regenerate
  - Undo AI
  - Restore Last (brings back archived prior diagram)

## AI Engine Notes

The server endpoint `POST /rooms/:roomId/ai-patch` generates constrained `DiagramPatch` JSON:

- operations: `upsertNode`, `upsertEdge`, `deleteShape`, `setTitle`, `setNotes`, `highlightOrder`, `layoutHint`
- supported diagram types: `tree`, `system_blocks`, `flowchart`
- priority handling:
  - typed corrections override transcript
  - pinned context is treated as ground truth
  - high-priority pinned context is always included first

Provider selection:

- `provider=deterministic`: local deterministic patch generator only
- `provider=openai`: OpenAI API (`OPENAI_API_KEY` or `ai.openai_api_key`, optional `openai_model`, default `gpt-4.1-mini`)
- `provider=codex_cli`: uses local `codex exec` CLI (requires `codex login status`; optional `codex_model`, default `gpt-5-codex`)
- `provider=auto` (default): OpenAI if key exists, otherwise deterministic
- Review loop: each patch is reviewed and revised up to `ai.review.max_revisions` until `ai.review.confidence_threshold` is met.

Example (Codex CLI provider via TOML): set `ai.provider = "codex_cli"` then run:

```bash
bun run server
```

## Demo Script

### Demo 1: Tree traversal

1. Create room, join from two browser windows.
2. Click **Start Mic**.
3. Say: `We have a tree with root A, children B and C. B has D and E.`
4. Say: `We'll do DFS pre-order.`
5. Verify tree + traversal order.
6. In second user window, send Chat as **Correction**:
   `Actually, it's post-order.`
7. Verify traversal order updates.

### Demo 2: System design transition

1. Click **Pin Diagram**.
2. Say: `Now architecture: Client -> API Gateway -> Service -> Postgres. Add Redis cache between service and DB.`
3. Verify a new diagram group appears beside the pinned one.
4. Add Context Bank item:
   - Title: `Constraint`
   - Content: `Must handle 10k RPS, prefer read cache.`
   - Priority: `High`
   - Pinned: `true`
5. Verify notes/context-driven updates after AI tick or **Regenerate**.

## Meet Demo Options

- Fast path: Share SenseBoard tab in Google Meet, keep Meet in picture-in-picture.
- Add-on path (later): package this web app via Meet add-ons HTTP deployment.
