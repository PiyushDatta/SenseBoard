import { createDiagramGroup, newId } from '../../shared/room-state';
import { applyBoardOp, applyBoardOps, createEmptyBoardState } from '../../shared/board-state';
import type {
  ArchivedDiagram,
  BoardElement,
  BoardOp,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  DiagramPatch,
  DiagramPatchAction,
  FocusBox,
  RoomState,
} from '../../shared/types';

const NODE_WIDTH = 160;
const NODE_HEIGHT = 72;
const MAX_ARCHIVED_GROUPS = 24;

const BOARD_STROKE = '#25333F';
const BOARD_TEXT = '#1E2B36';

const nodeCenter = (group: DiagramGroup, node: DiagramNode): [number, number] => {
  return [group.bounds.x + node.x + node.width / 2, group.bounds.y + node.y + node.height / 2];
};

const toBoardOps = (group: DiagramGroup): BoardOp[] => {
  const now = Date.now();
  const ops: BoardOp[] = [{ type: 'clearBoard' }];
  const elements: BoardElement[] = [];

  if (group.title) {
    elements.push({
      id: `title:${group.id}`,
      kind: 'text',
      x: group.bounds.x + 20,
      y: group.bounds.y - 24,
      text: group.title.slice(0, 140),
      createdAt: now,
      createdBy: 'ai',
      style: {
        strokeColor: BOARD_TEXT,
        fontSize: 28,
      },
    });
  }

  Object.values(group.nodes).forEach((node, index) => {
    const x = group.bounds.x + node.x;
    const y = group.bounds.y + node.y;
    elements.push({
      id: `shape:${group.id}:${node.id}`,
      kind: 'rect',
      x,
      y,
      w: node.width,
      h: node.height,
      createdAt: now + index,
      createdBy: 'ai',
      style: {
        strokeColor: BOARD_STROKE,
        fillColor: '#FFFFFF00',
        strokeWidth: 2,
        roughness: 2,
      },
    });
    elements.push({
      id: `label:${group.id}:${node.id}`,
      kind: 'text',
      x: x + 12,
      y: y + node.height / 2 + 6,
      text: node.label.slice(0, 80),
      createdAt: now + index,
      createdBy: 'ai',
      style: {
        strokeColor: BOARD_TEXT,
        fontSize: 18,
      },
    });
  });

  Object.values(group.edges).forEach((edge, index) => {
    const fromNode = group.nodes[edge.from];
    const toNode = group.nodes[edge.to];
    if (!fromNode || !toNode) {
      return;
    }
    const from = nodeCenter(group, fromNode);
    const to = nodeCenter(group, toNode);
    elements.push({
      id: `edge:${group.id}:${edge.id}`,
      kind: 'arrow',
      points: [from, to],
      createdAt: now + 200 + index,
      createdBy: 'ai',
      style: {
        strokeColor: BOARD_STROKE,
        strokeWidth: 2,
        roughness: 2,
      },
    });
    if (edge.label) {
      elements.push({
        id: `edgeLabel:${group.id}:${edge.id}`,
        kind: 'text',
        x: (from[0] + to[0]) / 2,
        y: (from[1] + to[1]) / 2 - 8,
        text: edge.label.slice(0, 40),
        createdAt: now + 250 + index,
        createdBy: 'ai',
        style: {
          strokeColor: BOARD_TEXT,
          fontSize: 14,
        },
      });
    }
  });

  if (group.notes.length > 0) {
    elements.push({
      id: `notes:${group.id}`,
      kind: 'text',
      x: group.bounds.x + 30,
      y: group.bounds.y + group.bounds.h + 46,
      text: group.notes.join(' | ').slice(0, 220),
      createdAt: now + 500,
      createdBy: 'ai',
      style: {
        strokeColor: '#3A4954',
        fontSize: 16,
      },
    });
  }

  if (group.highlightOrder.length > 0) {
    elements.push({
      id: `order:${group.id}`,
      kind: 'text',
      x: group.bounds.x + 30,
      y: group.bounds.y + group.bounds.h + 74,
      text: `Order: ${group.highlightOrder.join(' -> ')}`.slice(0, 220),
      createdAt: now + 510,
      createdBy: 'ai',
      style: {
        strokeColor: '#3A4954',
        fontSize: 15,
      },
    });
  }

  elements.forEach((element) => {
    ops.push({ type: 'upsertElement', element });
  });

  return ops;
};

const updatePinnedGroups = (room: RoomState) => {
  room.aiConfig.pinnedGroupIds = Object.values(room.diagramGroups)
    .filter((group) => group.pinned)
    .map((group) => group.id);
};

const nextGroupBounds = (room: RoomState): FocusBox => {
  const groups = Object.values(room.diagramGroups);
  if (groups.length === 0) {
    return { x: 120, y: 120, w: 760, h: 520 };
  }
  const rightMost = groups.reduce((current, group) => {
    const edge = group.bounds.x + group.bounds.w;
    if (!current || edge > current.edge) {
      return { edge, y: group.bounds.y };
    }
    return current;
  }, null as { edge: number; y: number } | null);

  return {
    x: (rightMost?.edge ?? 120) + 120,
    y: rightMost?.y ?? 120,
    w: 760,
    h: 520,
  };
};

const getOrCreateActiveGroup = (room: RoomState): DiagramGroup => {
  const existing = room.diagramGroups[room.activeGroupId];
  if (existing) {
    return existing;
  }
  const fresh = createDiagramGroup(newId(), 'Live Discussion', 'flowchart', nextGroupBounds(room));
  room.diagramGroups[fresh.id] = fresh;
  room.activeGroupId = fresh.id;
  return fresh;
};

const hasGroupContent = (group: DiagramGroup): boolean => {
  return (
    Object.keys(group.nodes).length > 0 ||
    Object.keys(group.edges).length > 0 ||
    group.notes.length > 0 ||
    group.highlightOrder.length > 0
  );
};

const normalizeTopicTokens = (value: string): Set<string> => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
  return new Set(normalized);
};

const topicSimilarity = (left: string, right: string): number => {
  const leftTokens = normalizeTopicTokens(left);
  const rightTokens = normalizeTopicTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  });
  const union = new Set<string>([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

const hasTopicShift = (group: DiagramGroup, patch: DiagramPatch): boolean => {
  if (group.diagramType !== patch.diagramType) {
    return true;
  }
  if (!group.topic || !patch.topic) {
    return false;
  }
  if (group.topic.toLowerCase().trim() === patch.topic.toLowerCase().trim()) {
    return false;
  }
  return topicSimilarity(group.topic, patch.topic) < 0.3;
};

const archiveGroup = (room: RoomState, group: DiagramGroup, reason: string) => {
  if (!hasGroupContent(group)) {
    return;
  }
  const archived: ArchivedDiagram = {
    id: newId(),
    archivedAt: Date.now(),
    reason,
    group: structuredClone(group),
  };
  room.archivedGroups.push(archived);
  if (room.archivedGroups.length > MAX_ARCHIVED_GROUPS) {
    room.archivedGroups = room.archivedGroups.slice(room.archivedGroups.length - MAX_ARCHIVED_GROUPS);
  }
};

const clearGroupContent = (group: DiagramGroup) => {
  group.nodes = {};
  group.edges = {};
  group.notes = [];
  group.highlightOrder = [];
};

const clampNodeToBounds = (node: DiagramNode, bounds: FocusBox): DiagramNode => {
  return {
    ...node,
    x: Math.max(0, Math.min(node.x, Math.max(0, bounds.w - node.width))),
    y: Math.max(0, Math.min(node.y, Math.max(0, bounds.h - node.height))),
  };
};

const resolveGroupForPatch = (room: RoomState, patch: DiagramPatch): DiagramGroup => {
  if (patch.targetGroupId && room.diagramGroups[patch.targetGroupId]) {
    const target = room.diagramGroups[patch.targetGroupId];
    if (!target.pinned) {
      room.activeGroupId = target.id;
      return target;
    }
  }

  const active = getOrCreateActiveGroup(room);
  if (!active.pinned) {
    return active;
  }

  const fresh = createDiagramGroup(newId(), patch.topic || 'New Topic', patch.diagramType, nextGroupBounds(room));
  room.diagramGroups[fresh.id] = fresh;
  room.activeGroupId = fresh.id;
  return fresh;
};

const applyTreeLayout = (group: DiagramGroup) => {
  const nodeIds = Object.keys(group.nodes);
  if (nodeIds.length === 0) {
    return;
  }

  const incoming = new Set<string>();
  const children = new Map<string, string[]>();

  Object.values(group.edges).forEach((edge) => {
    incoming.add(edge.to);
    const list = children.get(edge.from) ?? [];
    list.push(edge.to);
    children.set(edge.from, list);
  });

  const roots = nodeIds.filter((id) => !incoming.has(id));
  const root = roots[0] ?? nodeIds[0];

  const levels = new Map<string, number>();
  const queue: string[] = [root];
  levels.set(root, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current)!;
    for (const child of children.get(current) ?? []) {
      if (!levels.has(child)) {
        levels.set(child, level + 1);
        queue.push(child);
      }
    }
  }

  const rows = new Map<number, string[]>();
  nodeIds.forEach((id) => {
    const level = levels.get(id) ?? 0;
    const bucket = rows.get(level) ?? [];
    bucket.push(id);
    rows.set(level, bucket);
  });

  Array.from(rows.entries()).forEach(([level, ids]) => {
    const spacingX = 190;
    const startX = 40 + Math.max(0, (group.bounds.w - ids.length * spacingX) / 2);
    ids.forEach((id, index) => {
      const node = group.nodes[id];
      if (!node) {
        return;
      }
      node.x = startX + index * spacingX;
      node.y = 80 + level * 150;
    });
  });
};

const applyLayoutHint = (group: DiagramGroup, value: 'tree' | 'left-to-right' | 'top-down') => {
  if (value === 'tree') {
    applyTreeLayout(group);
    return;
  }

  const nodeIds = Object.keys(group.nodes);
  if (nodeIds.length === 0) {
    return;
  }

  nodeIds.forEach((id, index) => {
    const node = group.nodes[id];
    if (!node) {
      return;
    }
    if (value === 'left-to-right') {
      node.x = 60 + index * 220;
      node.y = Math.max(100, group.bounds.h / 2 - 60);
    } else {
      node.x = Math.max(80, group.bounds.w / 2 - 80);
      node.y = 60 + index * 130;
    }
  });
};

const applyAction = (group: DiagramGroup, room: RoomState, action: DiagramPatchAction) => {
  if (action.op === 'upsertNode') {
    const existing = group.nodes[action.id];
    const nextNode: DiagramNode = clampNodeToBounds(
      {
        id: action.id,
        label: action.label,
        x: action.x,
        y: action.y,
        width: action.width ?? existing?.width ?? NODE_WIDTH,
        height: action.height ?? existing?.height ?? NODE_HEIGHT,
      },
      group.bounds,
    );
    group.nodes[action.id] = nextNode;
    return;
  }

  if (action.op === 'upsertEdge') {
    if (!group.nodes[action.from] || !group.nodes[action.to]) {
      return;
    }
    const edge: DiagramEdge = {
      id: action.id,
      from: action.from,
      to: action.to,
      label: action.label,
    };
    group.edges[action.id] = edge;
    return;
  }

  if (action.op === 'deleteShape') {
    if (group.nodes[action.id]) {
      delete group.nodes[action.id];
      Object.values(group.edges)
        .filter((edge) => edge.from === action.id || edge.to === action.id)
        .forEach((edge) => delete group.edges[edge.id]);
      return;
    }
    delete group.edges[action.id];
    return;
  }

  if (action.op === 'setTitle') {
    group.title = action.text;
    return;
  }

  if (action.op === 'setNotes') {
    group.notes = action.lines.slice(0, 8);
    return;
  }

  if (action.op === 'highlightOrder') {
    group.highlightOrder = action.nodes.slice(0, 50);
    return;
  }

  if (action.op === 'layoutHint') {
    applyLayoutHint(group, action.value);
    return;
  }

  room.aiConfig.status = 'idle';
};

export const pinCurrentDiagram = (room: RoomState) => {
  const current = getOrCreateActiveGroup(room);
  current.pinned = true;
  current.updatedAt = Date.now();
  updatePinnedGroups(room);

  const fresh = createDiagramGroup(newId(), 'New Topic', 'flowchart', nextGroupBounds(room));
  room.diagramGroups[fresh.id] = fresh;
  room.activeGroupId = fresh.id;
};

export const clearBoard = (room: RoomState) => {
  const group = getOrCreateActiveGroup(room);
  clearGroupContent(group);
  room.board = applyBoardOp(room.board, { type: 'clearBoard' });
  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
};

export const undoAiPatch = (room: RoomState): boolean => {
  const history = room.aiHistory.pop();
  if (!history) {
    return false;
  }
  room.diagramGroups[history.previousGroupSnapshot.id] = structuredClone(history.previousGroupSnapshot);
  room.activeGroupId = history.previousGroupSnapshot.id;
  room.board = applyBoardOps(room.board, toBoardOps(history.previousGroupSnapshot));
  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
  return true;
};

export const restoreLatestArchivedDiagram = (room: RoomState): boolean => {
  const archived = room.archivedGroups.pop();
  if (!archived) {
    return false;
  }

  const restored = structuredClone(archived.group);
  restored.id = newId();
  restored.pinned = true;
  restored.createdAt = Date.now();
  restored.updatedAt = Date.now();
  restored.bounds = nextGroupBounds(room);
  restored.title = `[Restored] ${restored.title || restored.topic}`.slice(0, 120);

  room.diagramGroups[restored.id] = restored;
  room.activeGroupId = restored.id;
  room.board = applyBoardOps(room.board, toBoardOps(restored));
  updatePinnedGroups(room);
  return true;
};

export const applyDiagramPatch = (
  room: RoomState,
  patch: DiagramPatch,
  options: { regenerate?: boolean } = {},
): boolean => {
  if (room.aiConfig.frozen) {
    room.aiConfig.status = 'frozen';
    return false;
  }
  if (!room.board) {
    room.board = createEmptyBoardState();
  }

  const group = resolveGroupForPatch(room, patch);
  const previous = structuredClone(group);
  const topicShift = hasTopicShift(group, patch);

  if (room.aiConfig.focusMode && room.aiConfig.focusBox) {
    group.bounds = room.aiConfig.focusBox;
  }

  if (options.regenerate && hasGroupContent(group)) {
    archiveGroup(room, group, 'regenerate');
  }

  if (topicShift && hasGroupContent(group)) {
    archiveGroup(room, group, `topic_shift:${group.topic || 'unknown'}=>${patch.topic || 'unknown'}`);
  }

  if (options.regenerate || topicShift) {
    clearGroupContent(group);
  }

  group.topic = patch.topic;
  group.diagramType = patch.diagramType;
  group.updatedAt = Date.now();

  let hasSetTitle = false;
  patch.actions.forEach((action) => {
    if (action.op === 'setTitle') {
      hasSetTitle = true;
    }
    applyAction(group, room, action);
  });
  if (!hasSetTitle && patch.topic) {
    group.title = patch.topic;
  }

  room.board = applyBoardOps(room.board, toBoardOps(group));

  room.aiHistory.push({
    id: newId(),
    createdAt: Date.now(),
    patch,
    previousGroupSnapshot: previous,
  });
  if (room.aiHistory.length > 20) {
    room.aiHistory = room.aiHistory.slice(room.aiHistory.length - 20);
  }

  room.lastAiPatchAt = Date.now();
  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
  updatePinnedGroups(room);
  return true;
};
