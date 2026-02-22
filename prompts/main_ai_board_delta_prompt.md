# Task
Generate the next incremental board update from the current meeting state.
Treat transcriptWindow as immediate signal and transcriptContext as rolling memory.

## Mapping Rules
- For every transcriptWindow line, emit at least one concrete visual mapping in ops.
- Use words and visuals together for each meaningful idea.
- Prefer grouped structures (frames, lanes, clusters) when ideas are related.
- Use arrows and lines for chronology, dependency, feedback loops, and transformations.
- Keep IDs stable for concepts that persist over time.

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

## Text Overflow
- If details cannot fit cleanly in ops, place them in top-level "text".
- Keep text concise and actionable.
