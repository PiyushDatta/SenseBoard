import type { BoardElement, BoardOp, BoardPoint, BoardState, BoardViewport } from './types';

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

const applyElementOffset = (element: BoardElement, dx: number, dy: number): BoardElement => {
  if (element.kind === 'text') {
    return {
      ...element,
      x: clamp(element.x + dx, -MAX_COORD, MAX_COORD),
      y: clamp(element.y + dy, -MAX_COORD, MAX_COORD),
    };
  }
  if (element.kind === 'rect' || element.kind === 'ellipse' || element.kind === 'diamond') {
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
      : kindValue === 'polyline'
        ? 'line'
        : kindValue;
  if (
    kind !== 'text' &&
    kind !== 'rect' &&
    kind !== 'ellipse' &&
    kind !== 'diamond' &&
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
  if (base.kind === 'rect' || base.kind === 'ellipse' || base.kind === 'diamond') {
    return {
      ...base,
      x: clamp(pickNumber(raw.x, raw.left) ?? 0, -MAX_COORD, MAX_COORD),
      y: clamp(pickNumber(raw.y, raw.top) ?? 0, -MAX_COORD, MAX_COORD),
      w: clamp(pickNumber(raw.w, raw.width) ?? 1, 1, MAX_COORD),
      h: clamp(pickNumber(raw.h, raw.height) ?? 1, 1, MAX_COORD),
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
    if (!existing || existing.kind !== 'text') {
      return state;
    }
    const nextText = sanitizeText(op.text);
    if (!nextText || existing.text === nextText) {
      return state;
    }
    existing.text = nextText;
    touch(state);
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

