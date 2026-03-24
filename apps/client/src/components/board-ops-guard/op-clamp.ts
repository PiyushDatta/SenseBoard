import type { BoardElement, BoardElementStyle, BoardOp } from '../../../../shared/types';
import {
  AI_ELEMENT_BOUNDS,
  CANVAS_ELEMENT_BOUNDS,
  MAX_MOVE_DELTA,
  MAX_TEXT_LENGTH,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
} from './constants';
import {
  clampNumericValue,
  clampStrokePoints,
  isFiniteNumber,
  type ClampCounter,
} from './numeric';
import { sanitizeBoardText } from './text-sanitizer';
import { registerSkipReason } from './telemetry';

export interface ClampBoardOpResult {
  op: BoardOp;
  clamped: number;
  skippedChildren: number;
}

const STYLE_FIELDS: Array<keyof BoardElementStyle> = ['strokeColor', 'fillColor', 'strokeWidth', 'roughness', 'fontSize'];

const isStyleObject = (value: unknown): value is Partial<BoardElementStyle> =>
  Boolean(value) && typeof value === 'object';

const clampStylePatch = (style: unknown): Partial<BoardElementStyle> => {
  if (!isStyleObject(style)) {
    return {};
  }
  const next: Partial<BoardElementStyle> = {};
  if (typeof style.strokeColor === 'string') {
    next.strokeColor = style.strokeColor.slice(0, 64);
  }
  if (typeof style.fillColor === 'string') {
    next.fillColor = style.fillColor.slice(0, 64);
  }
  if (isFiniteNumber(style.strokeWidth)) {
    next.strokeWidth = Math.min(Math.max(style.strokeWidth ?? 1, 0.2), 32);
  }
  if (isFiniteNumber(style.roughness)) {
    next.roughness = Math.min(Math.max(style.roughness ?? 0, 0), 2);
  }
  if (isFiniteNumber(style.fontSize)) {
    next.fontSize = Math.min(Math.max(style.fontSize ?? 16, 8), 120);
  }
  return next;
};

const clampRectLike = <T extends { x: number; y: number; w: number; h: number }>(
  target: T,
  prefix: string,
  bounds: typeof CANVAS_ELEMENT_BOUNDS,
  clampReasons: Set<string>,
  counter: ClampCounter,
  yMax: number,
): T => {
  const width = clampNumericValue(target.w, 1, bounds.maxWidth, `${prefix}:w`, clampReasons, counter);
  const height = clampNumericValue(target.h, 1, bounds.maxHeight, `${prefix}:h`, clampReasons, counter);
  const maxX = Math.max(bounds.minX, bounds.maxX - width);
  const maxY = Math.max(bounds.minY, yMax - height);
  const x = clampNumericValue(target.x, bounds.minX, maxX, `${prefix}:x`, clampReasons, counter);
  const y = clampNumericValue(target.y, bounds.minY, maxY, `${prefix}:y`, clampReasons, counter);
  return {
    ...target,
    x,
    y,
    w: width,
    h: height,
  };
};

const sanitizeElementText = (
  value: unknown,
  allowEmpty: boolean,
  reasonPrefix: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
) => {
  const sanitized = sanitizeBoardText(value, { allowEmpty });
  if (!sanitized) {
    clampReasons.add(`${reasonPrefix}:invalid_text`);
    counter.count += 1;
    return null;
  }
  if (sanitized.rejected) {
    clampReasons.add(`${reasonPrefix}:empty`);
    counter.count += 1;
    return null;
  }
  if (sanitized.changed) {
    clampReasons.add(`${reasonPrefix}:sanitized`);
    counter.count += 1;
  }
  if (sanitized.empty) {
    clampReasons.add(`${reasonPrefix}:empty`);
  }
  return sanitized.text;
};

export const clampBoardElementForOps = (
  element: BoardElement | null | undefined,
  clampReasons: Set<string>,
  now: number,
): { element: BoardElement; clamped: number } | null => {
  if (!element || typeof element.id !== 'string' || element.id.trim().length === 0) {
    return null;
  }
  const createdAt = isFiniteNumber(element.createdAt) ? element.createdAt : now;
  const counter: ClampCounter = { count: 0 };
  const validCreatedBy = element.createdBy === 'ai' || element.createdBy === 'system';
  const sanitizedCreatedBy: BoardElement['createdBy'] = validCreatedBy ? element.createdBy : 'ai';
  if (!validCreatedBy) {
    clampReasons.add('upsert:created_by');
    counter.count += 1;
  }
  const bounds = sanitizedCreatedBy === 'ai' ? AI_ELEMENT_BOUNDS : CANVAS_ELEMENT_BOUNDS;
  const baseOverrides: Pick<BoardElement, 'createdAt' | 'createdBy' | 'style' | 'zIndex'> = {
    createdAt,
    createdBy: sanitizedCreatedBy,
    style: undefined,
    zIndex: undefined,
  };

  const stylePatch = clampStylePatch(element.style);
  const sanitizedStyle = Object.keys(stylePatch).length > 0 ? stylePatch : undefined;
  const styleChanged = STYLE_FIELDS.some(
    (field) => (element.style?.[field] ?? undefined) !== (sanitizedStyle?.[field] ?? undefined),
  );
  if (styleChanged) {
    clampReasons.add('upsert:style');
    counter.count += 1;
  }
  baseOverrides.style = sanitizedStyle;

  if (element.zIndex !== undefined) {
    if (isFiniteNumber(element.zIndex)) {
      const normalized = Math.round(Math.min(Math.max(element.zIndex, -100000), 100000));
      if (normalized !== element.zIndex) {
        clampReasons.add('upsert:zindex');
        counter.count += 1;
      }
      baseOverrides.zIndex = normalized;
    } else {
      baseOverrides.zIndex = undefined;
      clampReasons.add('upsert:zindex');
      counter.count += 1;
    }
  }

  const applyTextCoordinates = (target: Extract<BoardElement, { x: number; y: number }>) => {
    const x = clampNumericValue(target.x, bounds.minX, bounds.maxX, 'upsert:text_x', clampReasons, counter);
    const y = clampNumericValue(target.y, bounds.minY, bounds.maxY, 'upsert:text_y', clampReasons, counter);
    return { x, y };
  };

  if (element.kind === 'text') {
    const text = sanitizeElementText(element.text, true, 'upsert:text', clampReasons, counter);
    if (text === null) {
      return null;
    }
    const coords = applyTextCoordinates(element);
    return {
      element: {
        ...element,
        text,
        ...coords,
        ...baseOverrides,
      },
      clamped: counter.count,
    };
  }

  if (
    element.kind === 'rect' ||
    element.kind === 'ellipse' ||
    element.kind === 'diamond' ||
    element.kind === 'triangle' ||
    element.kind === 'sticky' ||
    element.kind === 'frame'
  ) {
    const prefix = `upsert:${element.kind}`;
    const rect = clampRectLike(element, prefix, bounds, clampReasons, counter, bounds.maxY);
    if (element.kind === 'sticky') {
      const stickyText = sanitizeElementText(element.text, true, 'upsert:sticky_text', clampReasons, counter);
      return {
        element: {
          ...rect,
          text: stickyText ?? '',
          ...baseOverrides,
        },
        clamped: counter.count,
      };
    }
    if (element.kind === 'frame' && typeof element.title === 'string') {
      rect.title = element.title.slice(0, MAX_TEXT_LENGTH);
    }
    return {
      element: {
        ...rect,
        ...baseOverrides,
      },
      clamped: counter.count,
    };
  }

  if (element.kind === 'line' || element.kind === 'stroke' || element.kind === 'arrow') {
    const points = clampStrokePoints(element.points, bounds, `upsert:${element.kind}_points`, clampReasons, counter);
    if (points.length < 2) {
      clampReasons.add(`upsert:${element.kind}_insufficient_points`);
      return null;
    }
    return {
      element: {
        ...element,
        points,
        ...baseOverrides,
      },
      clamped: counter.count,
    };
  }

  return null;
};

export const clampSingleBoardOp = (
  op: BoardOp | null | undefined,
  clampReasons: Set<string>,
  skipReasons: Map<string, number>,
  now: number,
): ClampBoardOpResult | null => {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    registerSkipReason(skipReasons, 'op:invalid');
    return null;
  }

  if (op.type === 'upsertElement') {
    const result = clampBoardElementForOps(op.element, clampReasons, now);
    if (!result) {
      registerSkipReason(skipReasons, 'upsert:invalid_element');
      return null;
    }
    return {
      op: { type: 'upsertElement', element: result.element },
      clamped: result.clamped,
      skippedChildren: 0,
    };
  }

  if (op.type === 'appendStrokePoints') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'append:id');
      return null;
    }
    const counter: ClampCounter = { count: 0 };
    const points = clampStrokePoints(op.points, CANVAS_ELEMENT_BOUNDS, 'append:points', clampReasons, counter);
    if (points.length === 0) {
      registerSkipReason(skipReasons, 'append:points_empty');
      return null;
    }
    return {
      op: { type: 'appendStrokePoints', id: op.id, points },
      clamped: counter.count,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setElementGeometry') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'geometry:id');
      return null;
    }
    const counter: ClampCounter = { count: 0 };
    const patch: BoardOp & { type: 'setElementGeometry' } = { type: 'setElementGeometry', id: op.id };
    let mutated = false;
    let nextWidth: number | undefined;
    if (op.w !== undefined) {
      nextWidth = clampNumericValue(op.w, 1, CANVAS_ELEMENT_BOUNDS.maxWidth, 'geometry:w', clampReasons, counter);
      patch.w = nextWidth;
      mutated = true;
    }
    let nextHeight: number | undefined;
    if (op.h !== undefined) {
      nextHeight = clampNumericValue(op.h, 1, CANVAS_ELEMENT_BOUNDS.maxHeight, 'geometry:h', clampReasons, counter);
      patch.h = nextHeight;
      mutated = true;
    }
    if (op.x !== undefined) {
      const widthForClamp = nextWidth ?? 1;
      const maxX = Math.max(CANVAS_ELEMENT_BOUNDS.minX, CANVAS_ELEMENT_BOUNDS.maxX - widthForClamp);
      patch.x = clampNumericValue(op.x, CANVAS_ELEMENT_BOUNDS.minX, maxX, 'geometry:x', clampReasons, counter);
      mutated = true;
    }
    if (op.y !== undefined) {
      const heightForClamp = nextHeight ?? 1;
      const maxY = Math.max(CANVAS_ELEMENT_BOUNDS.minY, CANVAS_ELEMENT_BOUNDS.maxY - heightForClamp);
      patch.y = clampNumericValue(op.y, CANVAS_ELEMENT_BOUNDS.minY, maxY, 'geometry:y', clampReasons, counter);
      mutated = true;
    }
    if (Array.isArray(op.points) && op.points.length > 0) {
      const points = clampStrokePoints(op.points, CANVAS_ELEMENT_BOUNDS, 'geometry:points', clampReasons, counter);
      if (points.length > 0) {
        patch.points = points;
        mutated = true;
      } else {
        registerSkipReason(skipReasons, 'geometry:points_invalid');
      }
    }
    if (!mutated) {
      registerSkipReason(skipReasons, 'geometry:empty');
      return null;
    }
    return {
      op: patch,
      clamped: counter.count,
      skippedChildren: 0,
    };
  }

  if (op.type === 'offsetElement') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'offset:id');
      return null;
    }
    const dx = isFiniteNumber(op.dx) ? Math.min(Math.max(op.dx, -MAX_MOVE_DELTA), MAX_MOVE_DELTA) : 0;
    const dy = isFiniteNumber(op.dy) ? Math.min(Math.max(op.dy, -MAX_MOVE_DELTA), MAX_MOVE_DELTA) : 0;
    if (dx === 0 && dy === 0) {
      registerSkipReason(skipReasons, 'offset:zero_delta');
      return null;
    }
    let clamped = 0;
    if (dx !== op.dx) {
      clampReasons.add('offset:dx');
      clamped += 1;
    }
    if (dy !== op.dy) {
      clampReasons.add('offset:dy');
      clamped += 1;
    }
    return {
      op: { type: 'offsetElement', id: op.id, dx, dy },
      clamped,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setElementText') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'text:id');
      return null;
    }
    const sanitizedText = sanitizeBoardText(op.text, { allowEmpty: true });
    if (!sanitizedText) {
      registerSkipReason(skipReasons, 'text:invalid');
      return null;
    }
    let clamped = 0;
    if (sanitizedText.changed) {
      clampReasons.add('text:sanitized');
      clamped += 1;
    }
    if (sanitizedText.empty) {
      clampReasons.add('text:empty');
    }
    return {
      op: { type: 'setElementText', id: op.id, text: sanitizedText.text },
      clamped,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setElementStyle') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'style:id');
      return null;
    }
    const style = clampStylePatch(op.style);
    if (Object.keys(style).length === 0) {
      registerSkipReason(skipReasons, 'style:empty');
      return null;
    }
    return {
      op: { type: 'setElementStyle', id: op.id, style },
      clamped: 0,
      skippedChildren: 0,
    };
  }

  if (op.type === 'deleteElement') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'delete:id');
      return null;
    }
    return {
      op: { type: 'deleteElement', id: op.id },
      clamped: 0,
      skippedChildren: 0,
    };
  }

  if (op.type === 'duplicateElement') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0 || typeof op.newId !== 'string' || op.newId.trim().length === 0) {
      registerSkipReason(skipReasons, 'duplicate:id');
      return null;
    }
    const dx = isFiniteNumber(op.dx) ? Math.min(Math.max(op.dx, -MAX_MOVE_DELTA), MAX_MOVE_DELTA) : 24;
    const dy = isFiniteNumber(op.dy) ? Math.min(Math.max(op.dy, -MAX_MOVE_DELTA), MAX_MOVE_DELTA) : 24;
    let clamped = 0;
    if (dx !== op.dx) {
      clampReasons.add('duplicate:dx');
      clamped += 1;
    }
    if (dy !== op.dy) {
      clampReasons.add('duplicate:dy');
      clamped += 1;
    }
    return {
      op: { type: 'duplicateElement', id: op.id, newId: op.newId, dx, dy },
      clamped,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setElementZIndex') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0 || !isFiniteNumber(op.zIndex)) {
      registerSkipReason(skipReasons, 'zindex:invalid');
      return null;
    }
    const zIndex = Math.round(Math.min(Math.max(op.zIndex, -100000), 100000));
    if (zIndex === op.zIndex) {
      return {
        op,
        clamped: 0,
        skippedChildren: 0,
      };
    }
    clampReasons.add('zindex:clamped');
    return {
      op: { type: 'setElementZIndex', id: op.id, zIndex },
      clamped: 1,
      skippedChildren: 0,
    };
  }

  if (op.type === 'alignElements') {
    const ids = Array.isArray(op.ids) ? op.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    if (ids.length < 2) {
      registerSkipReason(skipReasons, 'align:ids');
      return null;
    }
    const allowedAxes: Array<typeof op.axis> = ['left', 'center', 'right', 'x', 'top', 'middle', 'bottom', 'y'];
    const axis = allowedAxes.includes(op.axis) ? op.axis : 'center';
    if (axis !== op.axis) {
      clampReasons.add('align:axis');
    }
    return {
      op: { type: 'alignElements', ids, axis },
      clamped: axis === op.axis ? 0 : 1,
      skippedChildren: 0,
    };
  }

  if (op.type === 'distributeElements') {
    const ids = Array.isArray(op.ids) ? op.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    if (ids.length < 2) {
      registerSkipReason(skipReasons, 'distribute:ids');
      return null;
    }
    const allowedAxes: Array<typeof op.axis> = ['horizontal', 'vertical', 'x', 'y'];
    const axis = allowedAxes.includes(op.axis) ? op.axis : 'horizontal';
    if (axis !== op.axis) {
      clampReasons.add('distribute:axis');
    }
    let clamped = axis === op.axis ? 0 : 1;
    let gap: number | undefined;
    if (op.gap !== undefined) {
      const clampedGap = isFiniteNumber(op.gap) ? op.gap : 0;
      gap = Math.min(Math.max(clampedGap, -MAX_MOVE_DELTA), MAX_MOVE_DELTA);
      if (gap !== op.gap) {
        clampReasons.add('distribute:gap');
        clamped += 1;
      }
    }
    const payload = gap === undefined ? { type: 'distributeElements', ids, axis } : { type: 'distributeElements', ids, axis, gap };
    return {
      op: payload,
      clamped,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setViewport') {
    const viewport = op.viewport ?? {};
    const nextViewport: typeof viewport = {};
    const counter: ClampCounter = { count: 0 };
    let mutated = false;
    if (viewport.x !== undefined) {
      nextViewport.x = clampNumericValue(
        viewport.x,
        CANVAS_ELEMENT_BOUNDS.minX,
        CANVAS_ELEMENT_BOUNDS.maxX,
        'viewport:x',
        clampReasons,
        counter,
        CANVAS_ELEMENT_BOUNDS.minX,
      );
      mutated = true;
    }
    if (viewport.y !== undefined) {
      nextViewport.y = clampNumericValue(
        viewport.y,
        CANVAS_ELEMENT_BOUNDS.minY,
        CANVAS_ELEMENT_BOUNDS.maxY,
        'viewport:y',
        clampReasons,
        counter,
        CANVAS_ELEMENT_BOUNDS.minY,
      );
      mutated = true;
    }
    if (viewport.zoom !== undefined) {
      nextViewport.zoom = clampNumericValue(
        viewport.zoom,
        MIN_VIEWPORT_ZOOM,
        MAX_VIEWPORT_ZOOM,
        'viewport:zoom',
        clampReasons,
        counter,
        1,
      );
      mutated = true;
    }
    if (!mutated) {
      registerSkipReason(skipReasons, 'viewport:empty');
      return null;
    }
    return {
      op: { type: 'setViewport', viewport: nextViewport },
      clamped: counter.count,
      skippedChildren: 0,
    };
  }

  if (op.type === 'batch') {
    if (!Array.isArray(op.ops)) {
      registerSkipReason(skipReasons, 'batch:invalid');
      return null;
    }
    const sanitized: BoardOp[] = [];
    let clamped = 0;
    let skippedChildren = 0;
    for (const nested of op.ops) {
      const nestedResult = clampSingleBoardOp(nested as BoardOp, clampReasons, skipReasons, now);
      if (nestedResult) {
        sanitized.push(nestedResult.op);
        clamped += nestedResult.clamped;
        skippedChildren += nestedResult.skippedChildren;
      } else {
        skippedChildren += 1;
        registerSkipReason(skipReasons, 'batch:child');
      }
    }
    if (sanitized.length === 0) {
      registerSkipReason(skipReasons, 'batch:empty');
      return null;
    }
    return {
      op: { type: 'batch', ops: sanitized },
      clamped,
      skippedChildren,
    };
  }

  if (op.type === 'clearBoard') {
    return {
      op: { type: 'clearBoard' },
      clamped: 0,
      skippedChildren: 0,
    };
  }

  return {
    op,
    clamped: 0,
    skippedChildren: 0,
  };
};
