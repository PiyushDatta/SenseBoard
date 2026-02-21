import type { BoardElement, BoardOp, BoardState, BoardViewport } from './types';

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

const sanitizePoint = (point: [number, number]): [number, number] => {
  return [clamp(point[0], -MAX_COORD, MAX_COORD), clamp(point[1], -MAX_COORD, MAX_COORD)];
};

const sanitizeElement = (element: BoardElement): BoardElement | null => {
  if (!element || !element.id || typeof element.id !== 'string') {
    return null;
  }
  const now = Date.now();
  const base = {
    ...element,
    createdAt: Number.isFinite(element.createdAt) ? element.createdAt : now,
    zIndex: Number.isFinite(element.zIndex) ? element.zIndex : undefined,
  } as BoardElement;

  if (base.kind === 'text') {
    return {
      ...base,
      x: clamp(base.x, -MAX_COORD, MAX_COORD),
      y: clamp(base.y, -MAX_COORD, MAX_COORD),
      text: sanitizeText(base.text ?? ''),
    };
  }
  if (base.kind === 'rect' || base.kind === 'ellipse' || base.kind === 'diamond') {
    return {
      ...base,
      x: clamp(base.x, -MAX_COORD, MAX_COORD),
      y: clamp(base.y, -MAX_COORD, MAX_COORD),
      w: clamp(base.w, 1, MAX_COORD),
      h: clamp(base.h, 1, MAX_COORD),
    };
  }
  if (base.kind === 'stroke' || base.kind === 'arrow' || base.kind === 'line') {
    const points = (base.points ?? []).map(sanitizePoint).slice(0, 2400);
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

