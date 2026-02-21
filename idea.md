# Prompt: Build SenseBoard
“Live Canvas Illustrator” MVP (12-hour scope)

Tagline: Your hang, illustrated live.

Build this project. Below are instructions that should help, you are in control though, you decide whats best. Don't ask me, just build it, no mistakes. You have full priviledge within this directory and you can do `bun add <package>` if you want without my permission. Also feel free to run any commands.

You are an agent working in the SenseBoard repo to build a **Bun + Expo (React Native Web)** app that behaves like **Excalidraw**, but with an AI “meeting illustrator” that listens to a meeting (audio first), reads typed input (2nd), and optionally uses a lightweight “visual context hint” (3rd). Participants can also add items to a shared **Context Bank** during the meeting that give context to the AI.

This is only a web app for now. This is for a hackathon so we can be hacky and don't need to worry about auth or security. We will integrate with google meets, either google meets addon or Option B (fastest, still feels integrated): Present SenseBoard + Meet Picture-in-Picture.

The goal is a **demoable, shippable MVP in ~12 hours**: realtime multi-user canvas + live transcript + context bank + AI-generated diagrams that update as the conversation changes, with strong controls so the AI never feels out of control.

The current repo is setup as a bun + expo (react native) web only application, we start via `bun run start and then we open as web. Take your time building this, it doesn't need to be production ready, but needs to be modular and easy to add or remove things and easy to fix bugs (so maybe we add tests? bun run test?)

You are a senior distinguished engineer with 50+ years of programming experience and you know react native, bun, expo really well.
---

## 0) Product Summary

### What it is
A shared blank canvas (whiteboard) used during meetings. While people talk, type, and share context, the AI continuously maintains a **current diagram** of the topic being discussed: flowcharts, architecture blocks, and data structures (especially trees/graphs). The AI updates the board in near real time and can highlight traversal steps or processing order.

### What makes it unique
- **Modality priority**: Audio > Typed text > Visual hint > Other docs context
- **Context Bank**: Anyone can add pinned facts/snippets mid-meeting; these become “ground truth.”
- **Diagram DSL + patch updates**: The AI emits constrained JSON actions; the app applies patches to the canvas. No freeform chaos.
- **Human-in-the-loop controls**: Freeze AI, Pin diagram, Focus region, Regenerate last 30 seconds.

### The must-have demo
A presenter describes DFS/BFS tree traversal. AI draws the tree and highlights the traversal order. A participant types “Actually post-order.” AI updates instantly. Someone pins a context item with node labels. AI stabilizes. Presenter switches to system design call flow; AI starts a new diagram next to the pinned one.

---

## 1) Hard Constraints (MVP)

### Must be doable fast
- Web-first (Expo / React Native Web).
- Minimal dependencies; choose libraries that are easy to integrate and programmatically manipulate shapes.
- No full “screen share video understanding” in MVP. Replace with a **manual visual context hint** field.

### Must be controllable
The AI must not “take over.” Provide obvious toggles:
- **Freeze AI**: stop all automatic updates
- **Pin diagram**: preserve current diagram and start a new one beside it
- **Focus mode**: AI only edits within a bounding box/region
- **Regenerate**: rebuild current diagram from the last N seconds + context bank
- **Undo AI**: revert last AI patch (keep it simple, like one step rollback)

---

## 2) Modality Priority Rules (Critical)

The AI update loop must follow these priorities:

1) **Audio transcript** (highest priority)
   - Primary driver of topic and diagram updates.
   - Use the last ~20–40 seconds as “current discussion window.”

2) **Typed text** (second priority; authoritative overrides)
   - Chat messages and explicit corrections must override audio.
   - If a user marks a message as “Correction,” it is treated as truth and applied ASAP.

3) **Visual context hint** (third priority)
   - MVP: do not process actual screen video. Instead, a text box:
     - “Currently sharing: <design doc section title / URL / short snippet>”
   - This helps the AI anchor topic transitions.

4) **Context Bank** (always included; truthy constraints)
   - “Pinned” items are treated as ground truth unless explicitly replaced.
   - Items can be “High priority.” High priority beats everything else unless user says “update the context.”

### Conflict resolution policy
- If typed correction conflicts with audio: typed wins.
- If pinned context conflicts with audio: pinned wins unless user says “Context update: …”.
- If multiple pinned items conflict: ask one clarifying question in the UI (or show conflict banner), but MVP may just pick “most recent pinned item wins.”

---

## 3) MVP Feature Set (12 hours)

### A) Rooms + Realtime Collaboration (must-have)
- Create a room (short code or URL).
- Join room with display name.
- Shared canvas state synced to all participants.
- Presence cursors optional; not required.

Implementation options:
- **Yjs** with WebSocket provider
- or **Liveblocks** if already used in repo (choose the fastest integrated option)

### B) Canvas (must-have)
- A whiteboard surface that supports:
  - rectangles/boxes
  - arrows/edges
  - text labels
  - basic layout (position shapes)
- Must be programmatically modifiable (AI can add/update/remove shapes).

- **tldraw** (best for programmatic shape updates; web-first)
--> Use this: https://tldraw.dev/starter-kits/agent?utm_source=chatgpt.com
- If using RN Web, embed a web canvas component and bridge state; keep it simple.

### C) Live Transcript (must-have)
- Button: “Start Mic”
- Browser speech-to-text for MVP:
  - Use Web Speech API if available (Chrome).
  - Stream transcript chunks (2–4 seconds) into room state.
- Transcript panel visible to all.
- Optional: allow “speaker name” as the local user.

### D) Chat / Typed Notes + Corrections (must-have)
- A small right-side panel for chat/notes.
- Ability to tag a message as:
  - Normal note
  - **Correction** (authoritative)
  - “Suggestion” (soft)

### E) Context Bank (must-have)
A panel where any participant can add items:

Fields:
- Title
- Content (multi-line)
- Priority: Normal / High
- Scope: Global / Current topic
- Pinned: true/false

Behavior:
- Pinned + High priority items are always included in the AI prompt.
- Context bank items are shared in the room state.

### F) AI Diagram Engine (must-have)
The AI must output a **constrained JSON “Diagram Patch”** (see DSL below). The app applies patches to the canvas.

Update trigger:
- Every 5 seconds OR on “topic change” detection.
- Also trigger immediately upon:
  - new Correction message
  - new pinned context item
  - user clicking “Regenerate”

Rate limit:
- Never patch more than once every ~2 seconds.
- Debounce transcript spam.

---

## 4) Diagram DSL (Constrained Output)

### Why we need this
Freeform drawing commands are too chaotic. The AI must produce structured actions that are deterministic to apply.

### Supported diagram types (MVP: pick 3)
1) **flowchart**
2) **system_blocks** (architecture boxes + labeled arrows)
3) **tree** (nodes + edges + optional traversal order)

### JSON schema (example)
The AI response must be valid JSON with the following top-level fields.

> **Important:** do not wrap this JSON in a Markdown code fence in prompts or logs (some clients incorrectly terminate the overall markdown). Treat it as plain text / JSON block in the prompt.

JSON example:

{
  "topic": "Tree traversal example",
  "diagramType": "tree",
  "confidence": 0.74,
  "actions": [
    { "op": "upsertNode", "id": "A", "label": "A", "x": 0, "y": 0 },
    { "op": "upsertNode", "id": "B", "label": "B", "x": -160, "y": 140 },
    { "op": "upsertEdge", "id": "e1", "from": "A", "to": "B", "label": "left" },
    { "op": "setTitle", "text": "DFS pre-order traversal" },
    { "op": "setNotes", "lines": ["Visit node, then recurse left, then right."] },
    { "op": "highlightOrder", "nodes": ["A", "B", "D", "E", "C"] }
  ],
  "openQuestions": ["Should traversal be pre-order or post-order?"],
  "conflicts": [
    { "type": "correction", "detail": "Typed note says post-order; audio implied pre-order." }
  ]
}

### Action ops (MVP)
- `upsertNode`: create/update a node shape
- `upsertEdge`: create/update an arrow between nodes (store by id)
- `deleteShape`: remove a node/edge
- `setTitle`: update diagram title text
- `setNotes`: update a notes box
- `highlightOrder`: store order for optional highlighting (MVP may just display list)
- `layoutHint`: optional: “tree”, “left-to-right”, “top-down” (app can do basic layout)

### Focus / Pin integration
- Each diagram lives in a “diagram group” with a `groupId`.
- When pinned, `groupId` becomes read-only to AI.
- Focus mode provides a bounding box; AI actions must be applied only within that region (or only to shapes tagged with current `groupId`).

---

## 5) AI Prompting Requirements

### A) Inputs to include in every AI call
- Current time + room id
- Current diagram summary (topic, diagramType, existing nodes/edges count)
- The last N seconds of transcript (audio window)
- The last few chat messages (including correction tags)
- Context Bank pinned items (high priority included first)
- Visual context hint string (if present)
- Mode config: Freeze? Focus box? Pinned groups?

### B) Output requirements
- JSON only (no markdown).
- Must not exceed a modest size (avoid 500 nodes).
- Must follow modality priority rules (typed corrections override).
- Must minimize churn:
  - Prefer updating existing nodes/edges rather than re-creating all.

### C) Topic change behavior
If transcript suggests a new topic:
- If current diagram is not pinned: AI may transform it.
- If pinned: AI must create a new diagram group beside it.

### D) “Ask few questions”
The AI may propose `openQuestions`, but the UI should show at most **1–2** at a time.
MVP can simply display them without interactive resolution; bonus if we implement quick buttons.

---

## 6) UX Layout (MVP)

Single-page app:

- Center: Canvas
- Right sidebar with tabs:
  - Transcript
  - Chat
  - Context Bank
- Top bar:
  - Room code
  - Start/Stop Mic
  - Freeze AI toggle
  - Pin Diagram button
  - Focus Mode toggle (draw a rectangle)
  - Regenerate button
  - Undo AI button

Canvas should show:
- Diagram title + notes box
- Diagram content
- “AI status” indicator: listening / updating / frozen

---

## 7) Architecture (Suggested)

### Client (Expo RN Web)
- Canvas component (web-based if needed)
- Sidebar state
- Websocket connection for room sync

### Server (Bun)
- Room state store (in-memory is fine for MVP)
- WebSocket hub for Yjs or custom sync
- AI endpoint:
  - receives state snapshot + new transcript chunks
  - returns Diagram Patch JSON

### Data model (minimal)
Room:
- id, createdAt
- members
- transcriptChunks[]
- chatMessages[]
- contextItems[]
- visualHint
- aiConfig (freeze, focusBox, pinnedGroups)
- diagramState (current group id + shapes mapping)

---

## 8) Implementation Notes / Shortcuts (Preferred)

### Speech to text
- Use Web Speech API for speed.
- If not available, fallback to “manual transcript input” for demo.

### Visual understanding
- MVP does not parse screenshare video.
- Add a “Currently sharing:” input field + optional “paste snippet” button.

### AI loop scheduling
- Client can be the scheduler (host user triggers updates).
- Or server triggers when transcript updates arrive.
- Keep it deterministic and rate-limited.

### Safety
- No identity inference. No face recognition. No recording without explicit “Start Mic.”
- Clear UI indicator when mic is active.

---

## 9) Success Criteria (MVP “Done”)
- Two users join same room and see the same canvas updates.
- One user starts mic; transcript appears for all.
- AI draws a tree or flowchart based on the transcript within 5–10 seconds.
- A typed Correction changes the diagram reliably.
- A pinned context item influences subsequent updates.
- Freeze stops updates; Regenerate re-runs and updates the current diagram.
- Pin Diagram preserves prior diagram and AI starts a new diagram next to it.

---

## 10) Demo Script (Use This)

### Demo 1: Tree traversal
- Start mic: “We have a tree with root A, children B and C. B has D and E.”
- AI draws tree.
- Say: “We’ll do DFS pre-order.”
- AI shows highlight order A,B,D,E,C.
- Another user types Correction: “Actually, it’s post-order.”
- AI updates order to D,E,B,C,A and updates title.

### Demo 2: System design
- Pin tree diagram.
- Say: “Now architecture: Client -> API Gateway -> Service -> Postgres. Add Redis cache between service and DB.”
- AI draws boxes and arrows.
- Add context bank: “Constraint: must handle 10k RPS; prefer read cache.”
- AI updates notes and adds cache label.

---

## 11) Engineering Deliverables

`apps/client` (Expo RN Web):
- room join/create
- canvas + sidebars + controls
- mic capture + transcript stream

`apps/server` (Bun):
- websocket room hub (sync)
- AI patch endpoint + rate limiting
- in-memory persistence for MVP

A single `.md` doc explaining:
- how to run locally
- how to demo (script above)

---

## 12) Non-goals (Explicitly Out of Scope for 12h)
- Real screenshare video understanding (OCR/vision)
- Robust speaker diarization
- Full animation playback on canvas
- Deep long-term memory beyond context bank
- Perfect layouts / auto-routing arrows

---

## 13) Agent Task Breakdown (Swarm-friendly)

### Agent A: Realtime rooms + sync
- Room creation/join
- Shared canvas state sync

### Agent B: Canvas programmatic API + Diagram DSL renderer
- Implement shape upsert/update/delete
- Grouping + pin/focus boundaries

### Agent C: Mic + transcript pipeline
- Web Speech API integration
- Transcript UI + streaming into room state

### Agent D: Context Bank + Chat + Correction tags
- CRUD UI + shared state
- Priority + pinned logic

### Agent E: AI endpoint + prompt + patch loop
- Build prompt template
- Enforce JSON-only output
- Rate limiting and debounce
- Conflict resolution rules

### Agent F: Demo polish + UX controls
- Freeze / Pin / Focus / Undo / Regenerate
- AI status indicator

---

## 14) AI Prompt Template (Starter)

When implementing the AI call, use a system instruction like:

- You are generating a JSON diagram patch for a shared whiteboard.
- Follow modality priority: typed corrections > pinned context > transcript.
- Output JSON only, following the specified DSL.
- Update existing shapes when possible. Minimize churn.

The user payload should include:
- transcriptWindow
- corrections
- contextPinnedHigh
- contextPinnedNormal
- visualHint
- currentDiagramSummary
- aiConfig (freeze/focus/pin status)

---

## 15) Final Notes
The MVP should prioritize:
- predictability
- fast feedback
- human control
- clear demo

Do not attempt full multimodal screen analysis in MVP. The “visual hint” text box and context bank deliver the same conceptual value while keeping the build realistic.

Build the smallest thing that creates the “holy shit” moment: **talk → diagram appears → correction updates → pin and switch topics**.


Yes — there are two practical ways to demo SenseBoard “inside” a Google Meet call, and one easy “good enough for demo” approach.

Option A (best “inside Meet”): Build a Google Meet Add-on (Side panel / Main stage)

Google has an official Meet add-ons SDK that lets you surface your web app in Meet’s side panel and/or main stage.

What you can demo with this

Participants click your add-on in Meet → SenseBoard opens in a side panel or main stage.

Everyone sees the same shared canvas (because it’s still your app).

You can run mic capture inside your app UI (not Meet’s audio) and illustrate while the call is happening.

MVP-friendly path

Host SenseBoard as an HTTPS web app (your Bun server).

Wrap it as a Meet add-on using Google Cloud “HTTP deployment” (recommended by Google docs).

For a demo, you can usually keep it unlisted / internal / test users (so you don’t need Marketplace publishing).

Key caveat (important)

A Meet add-on does not automatically give you raw Meet audio to transcribe. The realistic demo path is:

capture audio from the user’s mic within SenseBoard (your “Start Listening” button),

or use Meet captions/transcript only as an input someone pastes (V2).

(That’s fine for a demo—your product story is “illustrates while you talk,” not “steals Meet audio.”)

Option B (fastest, still feels integrated): Present SenseBoard + Meet Picture-in-Picture

If you don’t want to build an add-on yet:

Open SenseBoard in a tab/window.

Turn on Meet picture-in-picture so the Meet call floats while you use SenseBoard.

Share your SenseBoard tab in Meet.

This demos great because everyone sees the live canvas, and you stay “in the meeting” with PiP.