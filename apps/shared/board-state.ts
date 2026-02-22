import type { BoardElement, BoardOp, BoardPoint, BoardState, BoardViewport } from './types';
import {
  SENSEBOARD_AI_CONTENT_MAX_X,
  SENSEBOARD_AI_CONTENT_MIN_X,
  SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
  SENSEBOARD_AI_ELEMENT_MAX_WIDTH,
  SENSEBOARD_CANVAS_HEIGHT,
  SENSEBOARD_CANVAS_PADDING,
  SENSEBOARD_CANVAS_WIDTH,
} from './board-dimensions';

const MAX_COORD = 200000;
const MAX_ELEMENTS = 1200;
const MAX_TEXT_LENGTH = 240;

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const sanitizeText = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
};

const pickNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
};

const toPoint = (value: unknown): BoardPoint | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = pickNumber(value[0]);
    const y = pickNumber(value[1]);
    if (x !== undefined && y !== undefined) {
      return [x, y];
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const point = value as Record<string, unknown>;
    const x = pickNumber(point.x);
    const y = pickNumber(point.y);
    if (x !== undefined && y !== undefined) {
      return [x, y];
    }
  }
  return null;
};

type LooseBoardElement = BoardElement & Record<string, unknown>;

const normalizeStyle = (element: LooseBoardElement): BoardElement['style'] | undefined => {
  const styleInput =
    element.style && typeof element.style === 'object' ? (element.style as Record<string, unknown>) : {};
  const strokeColor = pickString(styleInput.strokeColor, element.strokeColor, styleInput.color, element.color);
  const fillColor = pickString(styleInput.fillColor, element.fillColor);
  const strokeWidth = pickNumber(styleInput.strokeWidth, element.strokeWidth);
  const roughness = pickNumber(styleInput.roughness, element.roughness);
  const fontSize = pickNumber(styleInput.fontSize, element.fontSize);

  const style: BoardElement['style'] = {};
  if (strokeColor) {
    style.strokeColor = strokeColor;
  }
  if (fillColor) {
    style.fillColor = fillColor;
  }
  if (strokeWidth !== undefined) {
    style.strokeWidth = strokeWidth;
  }
  if (roughness !== undefined) {
    style.roughness = roughness;
  }
  if (fontSize !== undefined) {
    style.fontSize = fontSize;
  }

  if (Object.keys(style).length === 0) {
    return undefined;
  }
  return style;
};

const normalizeLinePoints = (element: LooseBoardElement): BoardPoint[] => {
  const parsed = (Array.isArray(element.points) ? element.points : [])
    .map((point) => toPoint(point))
    .filter((point): point is BoardPoint => Boolean(point));

  if (parsed.length > 0) {
    const offsetX = pickNumber(element.x);
    const offsetY = pickNumber(element.y);
    const first = parsed[0];
    if (offsetX !== undefined && offsetY !== undefined && first && Math.abs(first[0]) <= 2 && Math.abs(first[1]) <= 2) {
      return parsed.map((point) => [point[0] + offsetX, point[1] + offsetY]);
    }
    return parsed;
  }

  const startX = pickNumber(element.x1, element.x);
  const startY = pickNumber(element.y1, element.y);
  if (startX === undefined || startY === undefined) {
    return [];
  }

  const endX = pickNumber(element.x2) ?? startX + (pickNumber(element.w, element.width) ?? 120);
  const endY = pickNumber(element.y2) ?? startY + (pickNumber(element.h, element.height) ?? 0);
  return [
    [startX, startY],
    [endX, endY],
  ];
};

const sanitizePoint = (point: [number, number]): [number, number] => {
  return [clamp(point[0], -MAX_COORD, MAX_COORD), clamp(point[1], -MAX_COORD, MAX_COORD)];
};

const isSizedElement = (
  element: BoardElement,
): element is Extract<BoardElement, { kind: 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'sticky' | 'frame' }> => {
  return (
    element.kind === 'rect' ||
    element.kind === 'ellipse' ||
    element.kind === 'diamond' ||
    element.kind === 'triangle' ||
    element.kind === 'sticky' ||
    element.kind === 'frame'
  );
};

const getElementBounds = (element: BoardElement): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
} | null => {
  if (element.kind === 'text') {
    return {
      minX: element.x,
      maxX: element.x,
      minY: element.y,
      maxY: element.y,
      centerX: element.x,
      centerY: element.y,
    };
  }
  if (isSizedElement(element)) {
    const minX = element.x;
    const maxX = element.x + element.w;
    const minY = element.y;
    const maxY = element.y + element.h;
    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: minX + element.w / 2,
      centerY: minY + element.h / 2,
    };
  }
  if (element.kind === 'stroke' || element.kind === 'line' || element.kind === 'arrow') {
    if (element.points.length === 0) {
      return null;
    }
    let minX = element.points[0]![0];
    let maxX = element.points[0]![0];
    let minY = element.points[0]![1];
    let maxY = element.points[0]![1];
    for (const [x, y] of element.points) {
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }
  return null;
};

const setElementGeometry = (
  element: BoardElement,
  patch: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    points?: BoardPoint[];
  },
): BoardElement => {
  if (element.kind === 'text') {
    const nextX = typeof patch.x === 'number' && Number.isFinite(patch.x) ? clamp(patch.x, -MAX_COORD, MAX_COORD) : element.x;
    const nextY = typeof patch.y === 'number' && Number.isFinite(patch.y) ? clamp(patch.y, -MAX_COORD, MAX_COORD) : element.y;
    return {
      ...element,
      x: nextX,
      y: nextY,
    };
  }

  if (isSizedElement(element)) {
    const nextX = typeof patch.x === 'number' && Number.isFinite(patch.x) ? clamp(patch.x, -MAX_COORD, MAX_COORD) : element.x;
    const nextY = typeof patch.y === 'number' && Number.isFinite(patch.y) ? clamp(patch.y, -MAX_COORD, MAX_COORD) : element.y;
    const nextW = typeof patch.w === 'number' && Number.isFinite(patch.w) ? clamp(patch.w, 1, MAX_COORD) : element.w;
    const nextH = typeof patch.h === 'number' && Number.isFinite(patch.h) ? clamp(patch.h, 1, MAX_COORD) : element.h;
    return {
      ...element,
      x: nextX,
      y: nextY,
      w: nextW,
      h: nextH,
    };
  }

  if (element.kind === 'stroke' || element.kind === 'line' || element.kind === 'arrow') {
    if (Array.isArray(patch.points) && patch.points.length > 0) {
      return {
        ...element,
        points: patch.points.map(sanitizePoint).slice(0, 2400),
      };
    }
    return element;
  }

  return element;
};

const applyElementOffset = (element: BoardElement, dx: number, dy: number): BoardElement => {
  if (element.kind === 'text') {
    return {
      ...element,
      x: clamp(element.x + dx, -MAX_COORD, MAX_COORD),
      y: clamp(element.y + dy, -MAX_COORD, MAX_COORD),
    };
  }
  if (isSizedElement(element)) {
    return {
      ...element,
      x: clamp(element.x + dx, -MAX_COORD, MAX_COORD),
      y: clamp(element.y + dy, -MAX_COORD, MAX_COORD),
    };
  }
  if (element.kind === 'stroke' || element.kind === 'line' || element.kind === 'arrow') {
    return {
      ...element,
      points: element.points.map(([x, y]) => sanitizePoint([x + dx, y + dy])),
    };
  }
  return element;
};

const sanitizeStylePatch = (style: Partial<NonNullable<BoardElement['style']>>): NonNullable<BoardElement['style']> => {
  const patch: NonNullable<BoardElement['style']> = {};
  if (typeof style.strokeColor === 'string' && style.strokeColor.trim().length > 0) {
    patch.strokeColor = style.strokeColor.trim();
  }
  if (typeof style.fillColor === 'string' && style.fillColor.trim().length > 0) {
    patch.fillColor = style.fillColor.trim();
  }
  if (typeof style.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)) {
    patch.strokeWidth = clamp(style.strokeWidth, 0.5, 64);
  }
  if (typeof style.roughness === 'number' && Number.isFinite(style.roughness)) {
    patch.roughness = clamp(style.roughness, 0, 12);
  }
  if (typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)) {
    patch.fontSize = clamp(style.fontSize, 8, 200);
  }
  return patch;
};

const sanitizeElement = (element: BoardElement): BoardElement | null => {
  if (!element || !element.id || typeof element.id !== 'string') {
    return null;
  }
  const now = Date.now();
  const raw = element as LooseBoardElement;
  const kindValue = pickString(raw.kind)?.toLowerCase();
  const kind =
    kindValue === 'rectangle' || kindValue === 'box'
      ? 'rect'
      : kindValue === 'container'
        ? 'frame'
        : kindValue === 'note' || kindValue === 'postit'
          ? 'sticky'
          : kindValue === 'triangleup' || kindValue === 'triangle-down'
            ? 'triangle'
        : kindValue === 'polyline'
          ? 'line'
          : kindValue;
  if (
    kind !== 'text' &&
    kind !== 'rect' &&
    kind !== 'ellipse' &&
    kind !== 'diamond' &&
    kind !== 'triangle' &&
    kind !== 'sticky' &&
    kind !== 'frame' &&
    kind !== 'stroke' &&
    kind !== 'arrow' &&
    kind !== 'line'
  ) {
    return null;
  }

  const base = {
    ...raw,
    kind,
    createdAt: pickNumber(raw.createdAt) ?? now,
    createdBy: raw.createdBy === 'system' ? 'system' : 'ai',
    zIndex: pickNumber(raw.zIndex),
    style: normalizeStyle(raw),
  } as BoardElement;

  if (base.kind === 'text') {
    const text = sanitizeText(pickString(raw.text, raw.label, raw.title, raw.content) ?? '');
    if (!text) {
      return null;
    }
    return {
      ...base,
      x: clamp(pickNumber(raw.x, raw.left) ?? 0, -MAX_COORD, MAX_COORD),
      y: clamp(pickNumber(raw.y, raw.top) ?? 0, -MAX_COORD, MAX_COORD),
      text,
    };
  }
  if (
    base.kind === 'rect' ||
    base.kind === 'ellipse' ||
    base.kind === 'diamond' ||
    base.kind === 'triangle' ||
    base.kind === 'sticky' ||
    base.kind === 'frame'
  ) {
    const sanitizedBase = {
      ...base,
      x: clamp(pickNumber(raw.x, raw.left) ?? 0, -MAX_COORD, MAX_COORD),
      y: clamp(pickNumber(raw.y, raw.top) ?? 0, -MAX_COORD, MAX_COORD),
      w: clamp(pickNumber(raw.w, raw.width) ?? 1, 1, MAX_COORD),
      h: clamp(pickNumber(raw.h, raw.height) ?? 1, 1, MAX_COORD),
    };
    if (sanitizedBase.kind === 'sticky') {
      const text = sanitizeText(pickString(raw.text, raw.label, raw.title, raw.content) ?? 'Sticky');
      return {
        ...sanitizedBase,
        text,
      };
    }
    if (sanitizedBase.kind === 'frame') {
      const title = sanitizeText(pickString(raw.title, raw.text, raw.label) ?? '');
      return {
        ...sanitizedBase,
        ...(title ? { title } : {}),
      };
    }
    return {
      ...sanitizedBase,
    };
  }
  if (base.kind === 'stroke' || base.kind === 'arrow' || base.kind === 'line') {
    const points = normalizeLinePoints(raw).map(sanitizePoint).slice(0, 2400);
    if (points.length === 0) {
      return null;
    }
    return {
      ...base,
      points,
    };
  }
  return null;
};

export const createEmptyBoardState = (): BoardState => ({
  elements: {},
  order: [],
  revision: 0,
  lastUpdatedAt: Date.now(),
  viewport: {
    x: 0,
    y: 0,
    zoom: 1,
  },
});

const touch = (state: BoardState) => {
  state.revision += 1;
  state.lastUpdatedAt = Date.now();
};

const applySingleBoardOp = (state: BoardState, op: BoardOp): BoardState => {
  if (op.type === 'batch') {
    op.ops.forEach((nested) => {
      applySingleBoardOp(state, nested);
    });
    return state;
  }

  if (op.type === 'clearBoard') {
    state.elements = {};
    state.order = [];
    touch(state);
    return state;
  }

  if (op.type === 'deleteElement') {
    if (state.elements[op.id]) {
      delete state.elements[op.id];
      state.order = state.order.filter((id) => id !== op.id);
      touch(state);
    }
    return state;
  }

  if (op.type === 'setViewport') {
    const viewport: BoardViewport = {
      x: clamp(op.viewport.x ?? state.viewport.x, -MAX_COORD, MAX_COORD),
      y: clamp(op.viewport.y ?? state.viewport.y, -MAX_COORD, MAX_COORD),
      zoom: clamp(op.viewport.zoom ?? state.viewport.zoom, 0.2, 4),
    };
    state.viewport = viewport;
    touch(state);
    return state;
  }

  if (op.type === 'appendStrokePoints') {
    const existing = state.elements[op.id];
    if (!existing || existing.kind !== 'stroke') {
      return state;
    }
    const points = op.points.map(sanitizePoint).slice(0, 600);
    existing.points = [...existing.points, ...points].slice(0, 2400);
    touch(state);
    return state;
  }

  if (op.type === 'offsetElement') {
    const existing = state.elements[op.id];
    if (!existing) {
      return state;
    }
    const dx = Number.isFinite(op.dx) ? clamp(op.dx, -MAX_COORD, MAX_COORD) : 0;
    const dy = Number.isFinite(op.dy) ? clamp(op.dy, -MAX_COORD, MAX_COORD) : 0;
    if (dx === 0 && dy === 0) {
      return state;
    }
    state.elements[op.id] = applyElementOffset(existing, dx, dy);
    touch(state);
    return state;
  }

  if (op.type === 'setElementGeometry') {
    const existing = state.elements[op.id];
    if (!existing) {
      return state;
    }
    const next = setElementGeometry(existing, {
      x: typeof op.x === 'number' && Number.isFinite(op.x) ? op.x : undefined,
      y: typeof op.y === 'number' && Number.isFinite(op.y) ? op.y : undefined,
      w: typeof op.w === 'number' && Number.isFinite(op.w) ? op.w : undefined,
      h: typeof op.h === 'number' && Number.isFinite(op.h) ? op.h : undefined,
      points: Array.isArray(op.points) ? op.points : undefined,
    });
    state.elements[op.id] = next;
    touch(state);
    return state;
  }

  if (op.type === 'alignElements') {
    const ids = Array.from(new Set(op.ids)).filter((id) => Boolean(state.elements[id]));
    if (ids.length < 2) {
      return state;
    }
    const boundsList = ids
      .map((id) => ({ id, bounds: getElementBounds(state.elements[id]!) }))
      .filter((item): item is { id: string; bounds: NonNullable<ReturnType<typeof getElementBounds>> } => Boolean(item.bounds));
    if (boundsList.length < 2) {
      return state;
    }

    const anchorOf = (bounds: NonNullable<ReturnType<typeof getElementBounds>>): number => {
      if (op.axis === 'left') {
        return bounds.minX;
      }
      if (op.axis === 'right') {
        return bounds.maxX;
      }
      if (op.axis === 'center' || op.axis === 'x') {
        return bounds.centerX;
      }
      if (op.axis === 'top') {
        return bounds.minY;
      }
      if (op.axis === 'bottom') {
        return bounds.maxY;
      }
      return bounds.centerY;
    };

    const target = anchorOf(boundsList[0]!.bounds);
    let changed = false;

    for (const item of boundsList) {
      const current = anchorOf(item.bounds);
      const delta = target - current;
      let dx = 0;
      let dy = 0;
      if (op.axis === 'left' || op.axis === 'right' || op.axis === 'center' || op.axis === 'x') {
        dx = delta;
      } else {
        dy = delta;
      }
      if (dx === 0 && dy === 0) {
        continue;
      }
      state.elements[item.id] = applyElementOffset(state.elements[item.id]!, dx, dy);
      changed = true;
    }
    if (changed) {
      touch(state);
    }
    return state;
  }

  if (op.type === 'distributeElements') {
    const ids = Array.from(new Set(op.ids)).filter((id) => Boolean(state.elements[id]));
    if (ids.length < 3) {
      return state;
    }
    const horizontal = op.axis === 'horizontal' || op.axis === 'x';
    const boundItems = ids
      .map((id) => ({ id, bounds: getElementBounds(state.elements[id]!) }))
      .filter((item): item is { id: string; bounds: NonNullable<ReturnType<typeof getElementBounds>> } => Boolean(item.bounds))
      .sort((left, right) => (horizontal ? left.bounds.centerX - right.bounds.centerX : left.bounds.centerY - right.bounds.centerY));
    if (boundItems.length < 3) {
      return state;
    }

    const first = boundItems[0]!;
    const last = boundItems[boundItems.length - 1]!;
    const firstAnchor = horizontal ? first.bounds.centerX : first.bounds.centerY;
    const lastAnchor = horizontal ? last.bounds.centerX : last.bounds.centerY;
    const span = lastAnchor - firstAnchor;
    const computedStep = span / Math.max(1, boundItems.length - 1);
    const step =
      typeof op.gap === 'number' && Number.isFinite(op.gap) ? clamp(op.gap, -MAX_COORD, MAX_COORD) : computedStep;

    let changed = false;
    for (let index = 1; index < boundItems.length - 1; index += 1) {
      const item = boundItems[index]!;
      const target = firstAnchor + step * index;
      const current = horizontal ? item.bounds.centerX : item.bounds.centerY;
      const delta = target - current;
      const dx = horizontal ? delta : 0;
      const dy = horizontal ? 0 : delta;
      if (dx === 0 && dy === 0) {
        continue;
      }
      state.elements[item.id] = applyElementOffset(state.elements[item.id]!, dx, dy);
      changed = true;
    }
    if (changed) {
      touch(state);
    }
    return state;
  }

  if (op.type === 'setElementStyle') {
    const existing = state.elements[op.id];
    if (!existing) {
      return state;
    }
    const patch = sanitizeStylePatch(op.style);
    if (Object.keys(patch).length === 0) {
      return state;
    }
    existing.style = {
      ...(existing.style ?? {}),
      ...patch,
    };
    touch(state);
    return state;
  }

  if (op.type === 'setElementText') {
    const existing = state.elements[op.id];
    if (!existing) {
      return state;
    }
    const nextText = sanitizeText(op.text);
    if (!nextText) {
      return state;
    }
    if (existing.kind === 'text') {
      if (existing.text === nextText) {
        return state;
      }
      existing.text = nextText;
      touch(state);
      return state;
    }
    if (existing.kind === 'sticky') {
      if (existing.text === nextText) {
        return state;
      }
      existing.text = nextText;
      touch(state);
      return state;
    }
    if (existing.kind === 'frame') {
      if ((existing.title ?? '') === nextText) {
        return state;
      }
      existing.title = nextText;
      touch(state);
      return state;
    }
    if (existing.kind !== 'text' && existing.kind !== 'sticky' && existing.kind !== 'frame') {
      return state;
    }
    return state;
  }

  if (op.type === 'duplicateElement') {
    const source = state.elements[op.id];
    if (!source || !op.newId || typeof op.newId !== 'string') {
      return state;
    }
    if (state.elements[op.newId]) {
      return state;
    }
    if (state.order.length >= MAX_ELEMENTS) {
      return state;
    }

    const dx = Number.isFinite(op.dx) ? clamp(op.dx ?? 0, -MAX_COORD, MAX_COORD) : 24;
    const dy = Number.isFinite(op.dy) ? clamp(op.dy ?? 0, -MAX_COORD, MAX_COORD) : 24;
    const duplicated = applyElementOffset(
      {
        ...structuredClone(source),
        id: op.newId,
        createdAt: Date.now(),
      },
      dx,
      dy,
    );
    state.elements[op.newId] = duplicated;
    state.order.push(op.newId);
    touch(state);
    return state;
  }

  if (op.type === 'setElementZIndex') {
    const existing = state.elements[op.id];
    if (!existing) {
      return state;
    }
    const zIndex = Math.floor(clamp(op.zIndex, -100000, 100000));
    if (existing.zIndex === zIndex) {
      return state;
    }
    existing.zIndex = zIndex;
    touch(state);
    return state;
  }

  if (op.type === 'upsertElement') {
    const sanitized = sanitizeElement(op.element);
    if (!sanitized) {
      return state;
    }
    if (!state.elements[sanitized.id] && state.order.length >= MAX_ELEMENTS) {
      return state;
    }
    const alreadyExists = Boolean(state.elements[sanitized.id]);
    state.elements[sanitized.id] = sanitized;
    if (!alreadyExists) {
      state.order.push(sanitized.id);
    }
    touch(state);
    return state;
  }

  return state;
};

export const applyBoardOp = (state: BoardState, op: BoardOp): BoardState => {
  const next = structuredClone(state);
  return applySingleBoardOp(next, op);
};

export const applyBoardOps = (state: BoardState, ops: BoardOp[]): BoardState => {
  const next = structuredClone(state);
  ops.forEach((op) => {
    applySingleBoardOp(next, op);
  });
  return next;
};

export const clampBoardToCanvasBoundsInPlace = (state: BoardState): number => {
  let adjustedCount = 0;
  const canvasMinX = SENSEBOARD_CANVAS_PADDING;
  const canvasMaxX = SENSEBOARD_CANVAS_WIDTH - SENSEBOARD_CANVAS_PADDING;
  const canvasMinY = SENSEBOARD_CANVAS_PADDING;
  const canvasMaxY = SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING;
  const aiMinX = clamp(SENSEBOARD_AI_CONTENT_MIN_X, canvasMinX, canvasMaxX);
  const aiMaxX = clamp(SENSEBOARD_AI_CONTENT_MAX_X, aiMinX + 1, canvasMaxX);
  const canvasMaxWidth = Math.max(1, canvasMaxX - canvasMinX);
  const canvasMaxHeight = Math.max(1, canvasMaxY - canvasMinY);
  const aiLaneMaxWidth = Math.max(1, aiMaxX - aiMinX);

  for (const id of Object.keys(state.elements)) {
    const element = state.elements[id];
    if (!element) {
      continue;
    }
    const useAiLane = element.createdBy === 'ai';
    const minX = useAiLane ? aiMinX : canvasMinX;
    const maxX = useAiLane ? aiMaxX : canvasMaxX;
    const minY = canvasMinY;
    const maxY = canvasMaxY;
    const maxWidth = useAiLane
      ? Math.max(1, Math.min(canvasMaxWidth, aiLaneMaxWidth, SENSEBOARD_AI_ELEMENT_MAX_WIDTH))
      : canvasMaxWidth;
    const maxHeight = useAiLane ? Math.max(1, Math.min(canvasMaxHeight, SENSEBOARD_AI_ELEMENT_MAX_HEIGHT)) : canvasMaxHeight;

    if (element.kind === 'text') {
      const nextX = clamp(element.x, minX, maxX);
      const nextY = clamp(element.y, minY, maxY);
      if (nextX !== element.x || nextY !== element.y) {
        state.elements[id] = {
          ...element,
          x: nextX,
          y: nextY,
        };
        adjustedCount += 1;
      }
      continue;
    }

    if (
      element.kind === 'rect' ||
      element.kind === 'ellipse' ||
      element.kind === 'diamond' ||
      element.kind === 'triangle' ||
      element.kind === 'sticky' ||
      element.kind === 'frame'
    ) {
      const nextW = clamp(element.w, 1, maxWidth);
      const nextH = clamp(element.h, 1, maxHeight);
      const nextX = clamp(element.x, minX, Math.max(minX, maxX - nextW));
      const nextY = clamp(element.y, minY, Math.max(minY, maxY - nextH));
      if (nextX !== element.x || nextY !== element.y || nextW !== element.w || nextH !== element.h) {
        state.elements[id] = {
          ...element,
          x: nextX,
          y: nextY,
          w: nextW,
          h: nextH,
        };
        adjustedCount += 1;
      }
      continue;
    }

    if (element.kind === 'stroke' || element.kind === 'line' || element.kind === 'arrow') {
      let changed = false;
      const nextPoints: BoardPoint[] = [];
      for (const [x, y] of element.points) {
        const nx = clamp(x, minX, maxX);
        const ny = clamp(y, minY, maxY);
        if (nx !== x || ny !== y) {
          changed = true;
        }
        nextPoints.push([nx, ny]);
      }
      if (changed) {
        state.elements[id] = {
          ...element,
          points: nextPoints,
        };
        adjustedCount += 1;
      }
    }
  }

  if (adjustedCount > 0) {
    touch(state);
  }

  return adjustedCount;
};

