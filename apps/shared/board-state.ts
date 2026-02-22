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

