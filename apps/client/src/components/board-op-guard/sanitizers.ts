import type { BoardElement, BoardOp, BoardPoint } from '../../../shared/types';

export type GuardElementAuthor = BoardElement['createdBy'] | 'user';

export const BOARD_OP_GUARD_MAX_DELTA = 4096;
export const BOARD_OP_GUARD_MAX_COORD = 200000;
export const BOARD_OP_GUARD_MIN_ZOOM = 0.05;
export const BOARD_OP_GUARD_MAX_ZOOM = 5;
export const BOARD_OP_GUARD_PROVIDER_UNKNOWN = 'unknown';
export const BOARD_OP_GUARD_MAX_TEXT_LENGTH = 240;
export const BOARD_OP_GUARD_MAX_STYLE_CHARS = 64;

const VALID_ELEMENT_KINDS: Array<BoardElement['kind']> = [
  'stroke',
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'sticky',
  'frame',
  'arrow',
  'line',
  'text',
];

const BOARD_OP_GUARD_ALLOWED_AUTHORS = new Set<GuardElementAuthor>(['ai', 'system', 'user']);

export type GuardReasonRecord = Record<string, number>;

type GuardStylePatch = NonNullable<BoardElement['style']>;

export interface BoardOpGuardContext {
  maxDelta: number;
  clampReasons: GuardReasonRecord;
  dropReasons: GuardReasonRecord;
  droppedOps: number;
  clampedOps: number;
}

export const createBoardOpGuardContext = (maxDelta: number): BoardOpGuardContext => {
  return {
    maxDelta,
    clampReasons: {},
    dropReasons: {},
    droppedOps: 0,
    clampedOps: 0,
  };
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const recordGuardDrop = (ctx: BoardOpGuardContext, reason: string) => {
  ctx.droppedOps += 1;
  ctx.dropReasons[reason] = (ctx.dropReasons[reason] ?? 0) + 1;
};

const recordGuardClamp = (ctx: BoardOpGuardContext, reason: string) => {
  ctx.clampReasons[reason] = (ctx.clampReasons[reason] ?? 0) + 1;
};

const clampGuardDelta = (
  value: number,
  reason: string,
  ctx: BoardOpGuardContext,
): { value: number; clamped: boolean } => {
  const next = clampNumber(value, -ctx.maxDelta, ctx.maxDelta);
  if (next !== value) {
    recordGuardClamp(ctx, reason);
    return { value: next, clamped: true };
  }
  return { value, clamped: false };
};

const clampGuardCoordinateValue = (
  value: number,
  reason: string,
  ctx: BoardOpGuardContext,
): { value: number; clamped: boolean } => {
  const next = clampNumber(value, -BOARD_OP_GUARD_MAX_COORD, BOARD_OP_GUARD_MAX_COORD);
  if (next !== value) {
    recordGuardClamp(ctx, reason);
    return { value: next, clamped: true };
  }
  return { value, clamped: false };
};

const sanitizeGuardElementId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeGuardAuthor = (value: unknown): GuardElementAuthor | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return BOARD_OP_GUARD_ALLOWED_AUTHORS.has(normalized as GuardElementAuthor)
    ? (normalized as GuardElementAuthor)
    : null;
};

const sanitizeGuardPoint = (
  point: BoardPoint | null | undefined,
  ctx: BoardOpGuardContext,
  reason: string,
): { point: BoardPoint; clamped: boolean } | null => {
  if (!point) {
    return null;
  }
  const [xRaw, yRaw] = point;
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) {
    return null;
  }
  const clampX = clampGuardCoordinateValue(xRaw, `${reason}_x`, ctx);
  const clampY = clampGuardCoordinateValue(yRaw, `${reason}_y`, ctx);
  return { point: [clampX.value, clampY.value], clamped: clampX.clamped || clampY.clamped };
};

const sanitizeGuardPoints = (
  points: BoardPoint[] | undefined,
  ctx: BoardOpGuardContext,
  reason: string,
): { points: BoardPoint[]; clamped: boolean } => {
  if (!Array.isArray(points)) {
    return { points: [], clamped: false };
  }
  let clampedAny = false;
  const sanitized: BoardPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const result = sanitizeGuardPoint(points[index], ctx, reason);
    if (result) {
      sanitized.push(result.point);
      clampedAny ||= result.clamped;
    }
  }
  return { points: sanitized, clamped: clampedAny };
};

const sanitizeGuardTextValue = (value: string): { text: string; clamped: boolean } => {
  const normalizedWhitespace = value.replace(/\s+/g, ' ').trim();
  const truncated = normalizedWhitespace.slice(0, BOARD_OP_GUARD_MAX_TEXT_LENGTH);
  return {
    text: truncated,
    clamped: truncated !== value || normalizedWhitespace !== value,
  };
};

const sanitizeGuardStylePatch = (
  style: Partial<GuardStylePatch> | undefined,
): { style: Partial<GuardStylePatch>; clamped: boolean } | null => {
  if (!style || typeof style !== 'object') {
    return null;
  }

  let clamped = false;
  const sanitized: Partial<GuardStylePatch> = {};

  const normalizeColor = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const truncated = trimmed.slice(0, BOARD_OP_GUARD_MAX_STYLE_CHARS);
    if (truncated !== value) {
      clamped = true;
    }
    return truncated;
  };

  const normalizeNumber = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return value;
  };

  const strokeColor = normalizeColor(style.strokeColor);
  if (strokeColor) {
    sanitized.strokeColor = strokeColor;
  }
  const fillColor = normalizeColor(style.fillColor);
  if (fillColor) {
    sanitized.fillColor = fillColor;
  }
  const strokeWidth = normalizeNumber(style.strokeWidth);
  if (strokeWidth !== null) {
    sanitized.strokeWidth = strokeWidth;
  }
  const roughness = normalizeNumber(style.roughness);
  if (roughness !== null) {
    sanitized.roughness = roughness;
  }
  const fontSize = normalizeNumber(style.fontSize);
  if (fontSize !== null) {
    sanitized.fontSize = fontSize;
  }

  return Object.keys(sanitized).length > 0 ? { style: sanitized, clamped } : null;
};

const sanitizePointsForElement = (
  points: BoardPoint[] | undefined,
  ctx: BoardOpGuardContext,
  reason: string,
  minLength: number,
): { points: BoardPoint[]; clamped: boolean } | null => {
  const result = sanitizeGuardPoints(points, ctx, reason);
  if (result.points.length < minLength) {
    return null;
  }
  return result;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const sanitizeUpsertElement = (op: Extract<BoardOp, { type: 'upsertElement' }>, ctx: BoardOpGuardContext): BoardOp | null => {
  const element = op.element;
  if (!element) {
    recordGuardDrop(ctx, 'missing_element');
    return null;
  }

  const id = sanitizeGuardElementId((element as { id?: unknown }).id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_element_id');
    return null;
  }
  if (!VALID_ELEMENT_KINDS.includes(element.kind)) {
    recordGuardDrop(ctx, 'invalid_element_kind');
    return null;
  }
  if (!isFiniteNumber((element as { createdAt?: unknown }).createdAt)) {
    recordGuardDrop(ctx, 'invalid_element_timestamp');
    return null;
  }
  const author = sanitizeGuardAuthor((element as { createdBy?: unknown }).createdBy);
  if (!author) {
    recordGuardDrop(ctx, 'invalid_element_author');
    return null;
  }

  let sanitizedElement: BoardElement = element;
  let elementClamped = false;

  const cloneElementIfNeeded = () => {
    if (sanitizedElement === element) {
      sanitizedElement = { ...element };
    }
  };

  if (id !== element.id) {
    cloneElementIfNeeded();
    sanitizedElement.id = id;
    elementClamped = true;
    recordGuardClamp(ctx, 'element_id');
  }

  if (sanitizedElement.createdBy !== author) {
    cloneElementIfNeeded();
    sanitizedElement.createdBy = author as BoardElement['createdBy'];
    elementClamped = true;
    recordGuardClamp(ctx, 'element_author');
  }

  const clampCoord = (value: number, reason: string): number => {
    const result = clampGuardCoordinateValue(value, reason, ctx);
    elementClamped ||= result.clamped;
    return result.value;
  };

  const clampSize = (value: number, reason: string): number => {
    const normalized = clampNumber(Math.max(1, value), 1, BOARD_OP_GUARD_MAX_COORD);
    if (normalized !== value) {
      recordGuardClamp(ctx, reason);
      elementClamped = true;
    }
    return normalized;
  };

  const applyTextSanitizer = (value: string, reason: string) => {
    const normalized = sanitizeGuardTextValue(value);
    if (normalized.text !== value) {
      cloneElementIfNeeded();
      (sanitizedElement as Extract<BoardElement, { kind: 'text' | 'sticky' }>).text = normalized.text;
      elementClamped = true;
      if (normalized.clamped) {
        recordGuardClamp(ctx, reason);
      }
    }
  };

  const rejectGeometry = () => {
    recordGuardDrop(ctx, 'invalid_element_geometry');
    return null;
  };

  switch (sanitizedElement.kind) {
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
    case 'frame':
    case 'sticky': {
      if (
        !isFiniteNumber(sanitizedElement.x) ||
        !isFiniteNumber(sanitizedElement.y) ||
        !isFiniteNumber(sanitizedElement.w) ||
        !isFiniteNumber(sanitizedElement.h)
      ) {
        return rejectGeometry();
      }
      cloneElementIfNeeded();
      sanitizedElement.x = clampCoord(sanitizedElement.x, `${sanitizedElement.kind}_x`);
      sanitizedElement.y = clampCoord(sanitizedElement.y, `${sanitizedElement.kind}_y`);
      sanitizedElement.w = clampSize(sanitizedElement.w, `${sanitizedElement.kind}_w`);
      sanitizedElement.h = clampSize(sanitizedElement.h, `${sanitizedElement.kind}_h`);
      if (sanitizedElement.kind === 'sticky') {
        if (typeof sanitizedElement.text !== 'string') {
          recordGuardDrop(ctx, 'invalid_element_text');
          return null;
        }
        applyTextSanitizer(sanitizedElement.text, 'sticky_text');
      }
      break;
    }
    case 'text': {
      if (
        !isFiniteNumber(sanitizedElement.x) ||
        !isFiniteNumber(sanitizedElement.y) ||
        typeof sanitizedElement.text !== 'string'
      ) {
        recordGuardDrop(ctx, 'invalid_element_text');
        return null;
      }
      cloneElementIfNeeded();
      sanitizedElement.x = clampCoord(sanitizedElement.x, 'text_x');
      sanitizedElement.y = clampCoord(sanitizedElement.y, 'text_y');
      applyTextSanitizer(sanitizedElement.text, 'text_value');
      break;
    }
    case 'stroke':
    case 'line':
    case 'arrow': {
      const minLength = sanitizedElement.kind === 'stroke' ? 1 : 2;
      const points = sanitizePointsForElement(sanitizedElement.points, ctx, `${sanitizedElement.kind}_points`, minLength);
      if (!points) {
        recordGuardDrop(ctx, 'invalid_element_points');
        return null;
      }
      cloneElementIfNeeded();
      sanitizedElement.points = points.points;
      elementClamped ||= points.clamped;
      break;
    }
    default:
      break;
  }

  if (elementClamped) {
    ctx.clampedOps += 1;
  }
  return sanitizedElement === element ? op : { type: 'upsertElement', element: sanitizedElement };
};

const sanitizeBatchOp = (op: Extract<BoardOp, { type: 'batch' }>, ctx: BoardOpGuardContext): BoardOp | null => {
  const nested = sanitizeBoardOps(op.ops, ctx);
  if (nested.length === 0) {
    recordGuardDrop(ctx, 'empty_batch');
    return null;
  }
  return { type: 'batch', ops: nested };
};

const sanitizeAppendStrokePointsOp = (
  op: Extract<BoardOp, { type: 'appendStrokePoints' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_append_id');
    return null;
  }
  const { points, clamped } = sanitizeGuardPoints(op.points, ctx, 'append_points');
  if (points.length === 0) {
    recordGuardDrop(ctx, 'empty_points');
    return null;
  }
  if (clamped) {
    ctx.clampedOps += 1;
  }
  return { ...op, id, points };
};

const sanitizeOffsetElementOp = (op: Extract<BoardOp, { type: 'offsetElement' }>, ctx: BoardOpGuardContext): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_offset_id');
    return null;
  }
  if (!Number.isFinite(op.dx) || !Number.isFinite(op.dy)) {
    recordGuardDrop(ctx, 'invalid_offset_delta');
    return null;
  }
  const clampDx = clampGuardDelta(op.dx, 'offset_dx', ctx);
  const clampDy = clampGuardDelta(op.dy, 'offset_dy', ctx);
  if (clampDx.clamped || clampDy.clamped) {
    ctx.clampedOps += 1;
  }
  return { ...op, id, dx: clampDx.value, dy: clampDy.value };
};

const sanitizeDuplicateElementOp = (
  op: Extract<BoardOp, { type: 'duplicateElement' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  const newId = sanitizeGuardElementId(op.newId);
  if (!id || !newId) {
    recordGuardDrop(ctx, 'invalid_duplicate_id');
    return null;
  }
  let clamped = false;
  let dx = op.dx;
  if (dx !== undefined) {
    if (!Number.isFinite(dx)) {
      recordGuardDrop(ctx, 'invalid_duplicate_delta');
      return null;
    }
    const result = clampGuardDelta(dx, 'duplicate_dx', ctx);
    dx = result.value;
    clamped ||= result.clamped;
  }
  let dy = op.dy;
  if (dy !== undefined) {
    if (!Number.isFinite(dy)) {
      recordGuardDrop(ctx, 'invalid_duplicate_delta');
      return null;
    }
    const result = clampGuardDelta(dy, 'duplicate_dy', ctx);
    dy = result.value;
    clamped ||= result.clamped;
  }
  if (clamped) {
    ctx.clampedOps += 1;
  }
  return { ...op, id, newId, dx, dy };
};

const sanitizeSetElementGeometryOp = (
  op: Extract<BoardOp, { type: 'setElementGeometry' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_geometry_id');
    return null;
  }
  const next: Extract<BoardOp, { type: 'setElementGeometry' }> = { type: 'setElementGeometry', id };
  let hasUpdate = false;
  let clamped = false;

  if (isFiniteNumber(op.x)) {
    const result = clampGuardCoordinateValue(op.x, 'geometry_x', ctx);
    next.x = result.value;
    hasUpdate = true;
    clamped ||= result.clamped;
  }
  if (isFiniteNumber(op.y)) {
    const result = clampGuardCoordinateValue(op.y, 'geometry_y', ctx);
    next.y = result.value;
    hasUpdate = true;
    clamped ||= result.clamped;
  }
  if (isFiniteNumber(op.w)) {
    const normalized = clampNumber(Math.max(1, op.w), 1, BOARD_OP_GUARD_MAX_COORD);
    if (normalized !== op.w) {
      recordGuardClamp(ctx, 'geometry_w');
      clamped = true;
    }
    next.w = normalized;
    hasUpdate = true;
  }
  if (isFiniteNumber(op.h)) {
    const normalized = clampNumber(Math.max(1, op.h), 1, BOARD_OP_GUARD_MAX_COORD);
    if (normalized !== op.h) {
      recordGuardClamp(ctx, 'geometry_h');
      clamped = true;
    }
    next.h = normalized;
    hasUpdate = true;
  }
  if (op.points) {
    const points = sanitizeGuardPoints(op.points, ctx, 'geometry_points');
    if (points.points.length > 0) {
      next.points = points.points;
      hasUpdate = true;
      clamped ||= points.clamped;
    }
  }
  if (!hasUpdate) {
    recordGuardDrop(ctx, 'empty_geometry');
    return null;
  }
  if (clamped) {
    ctx.clampedOps += 1;
  }
  return next;
};

const sanitizeSetElementStyleOp = (
  op: Extract<BoardOp, { type: 'setElementStyle' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_style_id');
    return null;
  }
  const style = sanitizeGuardStylePatch(op.style);
  if (!style) {
    recordGuardDrop(ctx, 'empty_style');
    return null;
  }
  if (style.clamped) {
    ctx.clampedOps += 1;
    recordGuardClamp(ctx, 'style_payload');
  }
  return { ...op, id, style: style.style };
};

const sanitizeSetElementTextOp = (
  op: Extract<BoardOp, { type: 'setElementText' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_text_id');
    return null;
  }
  if (typeof op.text !== 'string') {
    recordGuardDrop(ctx, 'invalid_text');
    return null;
  }
  const normalized = sanitizeGuardTextValue(op.text);
  if (normalized.clamped) {
    ctx.clampedOps += 1;
    recordGuardClamp(ctx, 'text_value');
  }
  return { ...op, id, text: normalized.text };
};

const sanitizeSetElementZIndexOp = (
  op: Extract<BoardOp, { type: 'setElementZIndex' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_z_index_id');
    return null;
  }
  if (!Number.isFinite(op.zIndex)) {
    recordGuardDrop(ctx, 'invalid_z_index');
    return null;
  }
  return { ...op, id };
};

const sanitizeAlignElementsOp = (
  op: Extract<BoardOp, { type: 'alignElements' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const ids = Array.from(
    new Set((op.ids ?? []).filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)),
  );
  if (ids.length === 0) {
    recordGuardDrop(ctx, 'empty_align_ids');
    return null;
  }
  return { ...op, ids };
};

const sanitizeDistributeElementsOp = (
  op: Extract<BoardOp, { type: 'distributeElements' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const ids = Array.from(
    new Set((op.ids ?? []).filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)),
  );
  if (ids.length === 0) {
    recordGuardDrop(ctx, 'empty_distribute_ids');
    return null;
  }
  let gap = op.gap;
  let clamped = false;
  if (gap !== undefined) {
    if (!Number.isFinite(gap)) {
      recordGuardDrop(ctx, 'invalid_distribute_gap');
      return null;
    }
    const clampResult = clampGuardDelta(gap, 'distribute_gap', ctx);
    gap = clampResult.value;
    clamped = clampResult.clamped;
  }
  if (clamped) {
    ctx.clampedOps += 1;
  }
  return gap !== undefined ? { ...op, ids, gap } : { ...op, ids };
};

const sanitizeSetViewportOp = (op: Extract<BoardOp, { type: 'setViewport' }>, ctx: BoardOpGuardContext): BoardOp | null => {
  const viewport = op.viewport ?? {};
  const normalized: typeof op.viewport = {};
  let clamped = false;
  if (typeof viewport.x === 'number' && Number.isFinite(viewport.x)) {
    const result = clampGuardCoordinateValue(viewport.x, 'viewport_x', ctx);
    normalized.x = result.value;
    clamped ||= result.clamped;
  }
  if (typeof viewport.y === 'number' && Number.isFinite(viewport.y)) {
    const result = clampGuardCoordinateValue(viewport.y, 'viewport_y', ctx);
    normalized.y = result.value;
    clamped ||= result.clamped;
  }
  if (typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
    const nextZoom = clampNumber(viewport.zoom, BOARD_OP_GUARD_MIN_ZOOM, BOARD_OP_GUARD_MAX_ZOOM);
    if (nextZoom !== viewport.zoom) {
      recordGuardClamp(ctx, 'viewport_zoom');
      clamped = true;
    }
    normalized.zoom = nextZoom;
  }
  if (Object.keys(normalized).length === 0) {
    recordGuardDrop(ctx, 'empty_viewport');
    return null;
  }
  if (clamped) {
    ctx.clampedOps += 1;
  }
  return { type: 'setViewport', viewport: normalized };
};

const sanitizeDeleteElementOp = (
  op: Extract<BoardOp, { type: 'deleteElement' }>,
  ctx: BoardOpGuardContext,
): BoardOp | null => {
  const id = sanitizeGuardElementId(op.id);
  if (!id) {
    recordGuardDrop(ctx, 'invalid_delete_id');
    return null;
  }
  return { ...op, id };
};

const sanitizeBoardOp = (op: BoardOp | null | undefined, ctx: BoardOpGuardContext): BoardOp | null => {
  if (!op) {
    recordGuardDrop(ctx, 'null_op');
    return null;
  }

  switch (op.type) {
    case 'batch':
      return sanitizeBatchOp(op, ctx);
    case 'appendStrokePoints':
      return sanitizeAppendStrokePointsOp(op, ctx);
    case 'offsetElement':
      return sanitizeOffsetElementOp(op, ctx);
    case 'duplicateElement':
      return sanitizeDuplicateElementOp(op, ctx);
    case 'setElementGeometry':
      return sanitizeSetElementGeometryOp(op, ctx);
    case 'setElementStyle':
      return sanitizeSetElementStyleOp(op, ctx);
    case 'setElementText':
      return sanitizeSetElementTextOp(op, ctx);
    case 'setElementZIndex':
      return sanitizeSetElementZIndexOp(op, ctx);
    case 'alignElements':
      return sanitizeAlignElementsOp(op, ctx);
    case 'distributeElements':
      return sanitizeDistributeElementsOp(op, ctx);
    case 'setViewport':
      return sanitizeSetViewportOp(op, ctx);
    case 'deleteElement':
      return sanitizeDeleteElementOp(op, ctx);
    case 'clearBoard':
      return op;
    case 'upsertElement':
      return sanitizeUpsertElement(op, ctx);
    default:
      recordGuardDrop(ctx, 'unknown_op');
      return null;
  }
};

export const sanitizeBoardOps = (ops: BoardOp[] | undefined, ctx: BoardOpGuardContext): BoardOp[] => {
  if (!Array.isArray(ops)) {
    return [];
  }
  const sanitized: BoardOp[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const next = sanitizeBoardOp(ops[index], ctx);
    if (next) {
      sanitized.push(next);
    }
  }
  return sanitized;
};
