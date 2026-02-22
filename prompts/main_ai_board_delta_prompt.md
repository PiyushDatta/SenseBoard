# Task
Generate the next incremental board update from the current meeting state.
Treat transcriptWindow as immediate signal and transcriptContext as rolling memory.

## Mapping Rules
- For every transcriptWindow line, emit at least one concrete visual mapping in ops.
- Use words and visuals together for each meaningful idea.
- Prefer grouped structures (frames, lanes, clusters) when ideas are related.
- Use arrows and lines for chronology, dependency, feedback loops, and transformations.
- Keep IDs stable for concepts that persist over time.
- Add labels to the shapes you draw. Important blocks should not be unlabeled.
- Keep generated geometry within the primary view lane: x in [380,1480], y in [40,5600], width <= 980, height <= 720.
- Keep the output envelope canonical: `kind`, `schemaVersion`, `summary`, `ops`, `text`.
- Set `schemaVersion` to `1`.
- Renderer target is `tldraw`; keep element kinds and payloads compatible with tldraw mapping.
- For line/stroke/arrow, include at least 2 points.

## Creative Op Usage
- Use richer operations when helpful:
  offsetElement, setElementGeometry, setElementStyle, setElementText, duplicateElement, setElementZIndex, alignElements, distributeElements.
- Use batch for coherent sub-updates.
- Use style and z-index changes to show hierarchy, ownership, and current focus.

## Object Palette
- Use `sticky` for loose notes, questions, reminders, assumptions.
- Use `frame` to group related ideas into a cluster or lane.
- Use `triangle` for warnings, risks, blockers, or caution callouts.
- Use `diamond` for branching/decision logic.
- Use `alignElements` and `distributeElements` for quick cleanup after adding multiple nodes.

## Incrementality
- Anchor updates to currentBoardHint instead of hard resets.
- Use transcriptTaskChain (task1..taskN) as cumulative structure.
- Build on prior tasks rather than redrawing from scratch each turn.

## Safety Rules
- If transcriptWindow has meaningful content, do not return empty ops.
- If transcriptWindow has meaningful content, do not return metadata-only ops.
- If uncertain, emit robust placeholder visuals (rectangles + short text + connectors).
- Use canonical op keys only (`type`, `element`, `id`, `ops`, `viewport`, `points`, `style`).
- Do not emit alias keys like `op`, `action`, `operations`, `shape`, or `item`.

## Text Overflow
- If details cannot fit cleanly in ops, place them in top-level "text".
- Keep text concise and actionable.
