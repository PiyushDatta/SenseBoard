# SenseBoard Vision

> Make live conversations instantly legible by turning speech, context, and corrections into a shared visual board people can think with while the conversation is still happening.

---

## 1) Who this is for

### Primary users
- Meeting hosts, facilitators, and builders who need to explain evolving ideas live.
  - Jobs-to-be-done: capture spoken discussion, keep everyone aligned, show structure instead of raw notes, and recover quickly when the topic shifts.
  - Pain today: transcripts are linear, whiteboards are slow to maintain by hand, and generic AI output is often too vague or too unstable to trust in a live room.
  - Success looks like: within seconds, the room sees a readable board with labeled shapes, connectors, and clear clusters that track the conversation without constant manual cleanup.

### Secondary users
- Individual participants who need the conversation framed for their own role or interests.
  - Jobs-to-be-done: follow the shared board, keep personal context, and get a tailored view without breaking the room's common source of truth.
  - Pain today: one shared summary rarely fits everyone, and personal notes drift away from the team's current picture.
  - Success looks like: the main board stays canonical, while personal boards add focused context that helps each participant act on the discussion.

### Non-users
- Teams looking for a full-featured general whiteboard, drawing tool, or document editor.
  - Why: this repo is optimized for live AI-assisted meeting illustration, not open-ended canvas authoring or polished long-form docs.

---

## 2) The problem we solve

### Today's reality
- Spoken meetings create raw transcript streams, not shared understanding.
- Manual visual note-taking is too slow to keep up with live discussion.
- Unconstrained AI generation is brittle: it redraws too much, omits key ideas, or returns output that is not safe to render.
- Participants need both shared understanding and role-specific framing, but most tools force one or the other.

### The change we want
- In 6-12 months, SenseBoard should make it normal for a live conversation to produce an incremental visual board automatically, with controls to freeze, pin, focus, undo, and restore when needed.
- In 2-3 years, SenseBoard should feel like a meeting-native visual thinking layer: speech in, structured shared understanding out, with personal overlays that stay anchored to the same room truth.

### Before vs after
- Before: the room talks, someone tries to keep up, and the useful structure lives mostly in people's heads.
- After: the room talks, the board updates in place, corrections are reflected quickly, and the conversation stays visible as a diagram instead of disappearing into transcript history.

---

## 3) Product principles

1. **Visible output beats AI theater**
   - We will: prefer concrete, renderable board ops that create labeled shapes, text, and connectors.
   - We won't: treat verbose summaries or metadata-only output as success when the board should visibly change.

2. **Incremental updates beat redraws**
   - We will: extend current board state, keep stable IDs where possible, and make small deltas the default.
   - We won't: allow the model to rebuild the board from scratch on every turn unless the user explicitly asks for regeneration.

3. **Shared truth comes first**
   - We will: keep the main board authoritative and give it queue priority over personalized views.
   - We won't: let personalization silently replace or compete with the room's shared picture.

4. **User control beats hidden automation**
   - We will: preserve controls like Freeze AI, Pin Diagram, Focus Mode, Undo AI, and archived restore.
   - We won't: force users to accept drift, topic resets, or unwanted changes with no recovery path.

5. **Constrained interfaces beat model freedom**
   - We will: keep the board-op schema strict, renderer-compatible, and testable.
   - We won't: expand the prompt contract or shape vocabulary in ways that reduce reliability or break the canvas.

6. **Debuggability is a feature**
   - We will: keep config explicit, preflight meaningful, fixtures replayable, and fallbacks deterministic when needed.
   - We won't: depend on opaque provider behavior with no way to reproduce failures locally.

---

## 4) What good looks like

### User-facing outcomes
- Time-to-first-board: a new room produces its first useful visual update within one short speaking turn.
- Legibility: meaningful transcript windows produce readable mixed-modality output, not text dumps or empty ops.
- Trust: corrections, pinned context, and visual hints reliably influence the next board update.
- Recovery: users can freeze, undo, restore, and refocus without losing the room's working context.

### Developer and maintainer outcomes
- Reliability: board-op responses stay schema-valid and `tldraw`-compatible.
- Reproducibility: transcription and AI failures can be replayed through fixtures, preflight, or deterministic fallback.
- Change velocity: prompt, board-state, and renderer changes remain covered by fast local tests plus targeted integration checks.
- Operational clarity: provider routing and fallback behavior stay observable in logs and config.

---

## 5) Scope and boundaries

### In scope
- Live room-based collaboration over web.
- Realtime transcript, chat, context, and visual-hint ingestion.
- Constrained AI generation that outputs incremental `board_ops`.
- Shared main board plus per-user personal board generation.
- Topic-shift handling, archived restore, and operator controls for steering the AI.
- Testable server and client flows for transcription, prompting, board state, and renderer compatibility.

### Out of scope
- A full replacement for Figma, Excalidraw, Miro, or a general-purpose whiteboard.
- Rich manual authoring workflows as the primary experience.
- Native-first mobile UX; this repo is currently web-first.
- Long-form meeting memory, search, or enterprise knowledge management beyond the active room and current personalization store.
- Open-ended agent behavior outside the board schema and room model.

---

## 6) Current priorities

1. **Make live board updates consistently useful**
   - Why now: the core promise fails if transcript input does not become a readable board every time.
   - Success criteria: meaningful transcript windows produce renderable labeled visuals, with deterministic fallback covering provider misses.

2. **Harden the realtime loop**
   - Why now: room creation, websocket handshake, port discovery, AI queueing, and preflight all need to feel dependable for live use.
   - Success criteria: a user can start the app, join a room, speak, and see stable updates without hidden setup issues.

3. **Improve personal boards without weakening the main board**
   - Why now: personalization is a differentiator only if it stays useful, timely, and clearly secondary to shared truth.
   - Success criteria: personal boards refresh predictably, use stored context well, and do not starve or contradict the shared board.

4. **Preserve reproducibility as the product evolves**
   - Why now: prompt and provider changes will keep happening, and this repo needs a tight loop for catching regressions.
   - Success criteria: fixtures, tests, and preflight cover the critical live path from audio/transcript to board render.

---

## 7) Near-term objectives

### Objective A: Reliable live visual note-taking
- Problem: live AI output can fail through empty responses, weak mappings, or invalid board operations.
- Approach: keep prompts strict, sanitize and clamp board ops aggressively, and fall back to deterministic transcript-driven sketches when needed.
- Deliverables: stronger board-op route reliability, stable mixed-modality rendering, and fewer cases where speech produces no useful visible result.
- Risks: provider drift, audio quality variance, and latency spikes during live use.
- Exit criteria: typical demo sessions produce consistent readable board updates without manual rescue.

### Objective B: Useful shared-plus-personal collaboration
- Problem: one board is not enough for every participant, but multiple boards can fragment the room.
- Approach: treat the main board as canonical, keep personal boards lower-priority and additive, and use the personalization store to tailor emphasis.
- Deliverables: stable board-mode switching, stronger personal-board prompts, and clearer behavior around context updates and refresh cadence.
- Risks: confusion about which board is authoritative and over-personalization that loses the room thread.
- Exit criteria: participants can switch between main and personal views and still describe the same conversation state.

### Objective C: Operator confidence in the system
- Problem: live AI is only usable when hosts can steer and recover from it.
- Approach: keep control surfaces explicit and make state transitions observable through status, history, archived restore, and logs.
- Deliverables: dependable freeze, pin, focus, undo, restore, and preflight behavior.
- Risks: hidden queue interactions and unclear failure modes during demos.
- Exit criteria: hosts can intentionally steer the board through a topic change or bad generation without losing trust in the session.

---

## 8) Long-term direction

### Strategic bets
- **Bet 1: Meeting-native visual computing**
  - Why it matters: people understand structure faster from diagrams than from transcript walls.
  - What we'll likely build: stronger live mapping from speech to diagrams, better topic handling, and smoother human-in-the-loop control.
  - What we likely won't build: a generic canvas product detached from live conversation.

- **Bet 2: Constrained board ops as the stable interface**
  - Why it matters: reliability comes from narrowing the contract between AI and UI.
  - What we'll likely build: a more capable but still strict visual grammar, better schema validation, and tighter renderer guarantees.
  - What we likely won't build: free-form model output that bypasses board state safeguards.

- **Bet 3: Shared board plus personal overlays**
  - Why it matters: teams need common alignment and individual relevance at the same time.
  - What we'll likely build: better personalization signals, clearer board-mode semantics, and stronger separation between canonical state and tailored views.
  - What we likely won't build: disconnected private summaries with no relation to the room's shared visual model.

### If we're right, then...
- Users will expect important conversations to become visual while they happen.
- Maintainers will spend less time fighting prompt chaos because the generation contract is narrow and testable.
- This repo will be a strong foundation for live multimodal collaboration rather than a one-off demo.

---

## 9) Guardrails and constraints

### Guardrails
- Prefer reversible actions and explicit controls over hidden autonomous behavior.
- When transcript input has meaning, produce visible board output or a deterministic fallback, not silence.
- Keep the main board canonical and personalization subordinate.
- Maintain compatibility with the supported board element kinds and `tldraw` mapping.
- Favor web-first reliability, small deltas, and test-backed changes over flashy but fragile behavior.

### Constraints
- This is still an MVP with limited maintainer bandwidth.
- The system depends on external AI and transcription providers, each with cost, latency, and availability tradeoffs.
- Browser audio capture quality is variable and can dominate downstream results.
- Privacy expectations around live transcripts and captured audio must remain explicit in config and operations.

---

## 10) How decisions get made

- **Source of truth:** the code, `README.md`, prompt files in `prompts/`, and this vision document should agree on what SenseBoard is trying to do.
- **Require deliberate review for:** schema changes, renderer contract changes, queueing changes, provider-routing changes, and new user-visible workflow controls.
- **Review expectation:** critical-path changes should include tests or fixtures when practical, especially around transcription, prompt contracts, board state, and render compatibility.
- **What we won't merge lightly:** large rewrites without an incremental path, features that turn SenseBoard into a generic canvas, and prompt changes that widen the AI contract without stronger safeguards.
