import {
  SENSEBOARD_AI_CONTENT_MAX_X,
  SENSEBOARD_AI_CONTENT_MIN_X,
  SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
  SENSEBOARD_AI_ELEMENT_MAX_WIDTH,
  SENSEBOARD_CANVAS_HEIGHT,
  SENSEBOARD_CANVAS_PADDING,
  SENSEBOARD_CANVAS_WIDTH,
} from '../../../shared/board-dimensions';
import type { BoardElement, BoardElementStyle, BoardOp, BoardOpsEnvelope, BoardPoint, BoardState } from '../../../shared/types';

export type TldrawColorName =
  | 'black'
  | 'grey'
  | 'light-violet'
  | 'violet'
  | 'blue'
  | 'light-blue'
  | 'yellow'
  | 'orange'
  | 'green'
  | 'light-green'
  | 'light-red'
  | 'red';

export type TldrawDashStyle = 'solid' | 'dashed' | 'dotted' | 'draw';
export type TldrawSizeStyle = 's' | 'm' | 'l' | 'xl';
export type TldrawFillStyle = 'none' | 'solid' | 'semi' | 'pattern' | 'fill' | 'lined-fill';

interface TldrawDraftBase {
  id: string;
  zIndex: number;
}

export interface TldrawDraftGeoShape extends TldrawDraftBase {
  kind: 'geo';
  x: number;
  y: number;
  props: {
    geo: 'rectangle' | 'ellipse' | 'diamond' | 'triangle';
    w: number;
    h: number;
    color: TldrawColorName;
    labelColor: TldrawColorName;
    fill: TldrawFillStyle;
    size: TldrawSizeStyle;
    dash: TldrawDashStyle;
    text: string;
    align: 'start' | 'middle' | 'end';
    verticalAlign: 'start' | 'middle' | 'end';
  };
}

export interface TldrawDraftFrameShape extends TldrawDraftBase {
  kind: 'frame';
  x: number;
  y: number;
  props: {
    w: number;
    h: number;
    name: string;
    color: TldrawColorName;
  };
}

export interface TldrawDraftTextShape extends TldrawDraftBase {
  kind: 'text';
  x: number;
  y: number;
  props: {
    text: string;
    color: TldrawColorName;
    size: TldrawSizeStyle;
    w: number;
    autoSize: boolean;
  };
}

export interface TldrawDraftPoint {
  id: string;
  index: string;
  x: number;
  y: number;
}

export interface TldrawDraftLineShape extends TldrawDraftBase {
  kind: 'line';
  x: number;
  y: number;
  props: {
    color: TldrawColorName;
    dash: TldrawDashStyle;
    size: TldrawSizeStyle;
    spline: 'line' | 'cubic';
    points: TldrawDraftPoint[];
  };
}

export interface TldrawDraftArrowShape extends TldrawDraftBase {
  kind: 'arrow';
  x: number;
  y: number;
  props: {
    kind: 'arc' | 'elbow';
    color: TldrawColorName;
    fill: TldrawFillStyle;
    dash: TldrawDashStyle;
    size: TldrawSizeStyle;
    arrowheadStart: 'none' | 'arrow' | 'triangle' | 'square' | 'dot' | 'pipe' | 'diamond' | 'inverted' | 'bar';
    arrowheadEnd: 'none' | 'arrow' | 'triangle' | 'square' | 'dot' | 'pipe' | 'diamond' | 'inverted' | 'bar';
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
}

export type TldrawDraftShape =
  | TldrawDraftGeoShape
  | TldrawDraftFrameShape
  | TldrawDraftTextShape
  | TldrawDraftLineShape
  | TldrawDraftArrowShape;

interface TextContainerBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIZE_TO_APPROX_FONT_PX: Record<TldrawSizeStyle, number> = {
  s: 14,
  m: 18,
  l: 24,
  xl: 32,
};

const TL_COLOR_PALETTE: Array<{ name: TldrawColorName; rgb: [number, number, number] }> = [
  { name: 'black', rgb: [30, 40, 48] },
  { name: 'grey', rgb: [129, 141, 152] },
  { name: 'light-violet', rgb: [182, 165, 255] },
  { name: 'violet', rgb: [124, 102, 220] },
  { name: 'blue', rgb: [61, 99, 222] },
  { name: 'light-blue', rgb: [66, 170, 247] },
  { name: 'yellow', rgb: [241, 198, 57] },
  { name: 'orange', rgb: [242, 142, 43] },
  { name: 'green', rgb: [80, 168, 98] },
  { name: 'light-green', rgb: [132, 186, 91] },
  { name: 'light-red', rgb: [242, 128, 133] },
  { name: 'red', rgb: [222, 81, 81] },
];

const NAMED_COLOR_OVERRIDES: Record<string, TldrawColorName> = {
  black: 'black',
  gray: 'grey',
  grey: 'grey',
  white: 'grey',
  blue: 'blue',
  navy: 'blue',
  cyan: 'light-blue',
  teal: 'light-blue',
  yellow: 'yellow',
  gold: 'yellow',
  amber: 'orange',
  orange: 'orange',
  green: 'green',
  lime: 'light-green',
  red: 'red',
  pink: 'light-red',
  purple: 'violet',
  violet: 'violet',
};

const TRANSPARENT_VALUES = new Set(['transparent', 'none', '']);

const normalize = (value: string): string => value.trim().toLowerCase();

const parseHexColor = (value: string): [number, number, number] | null => {
  const hex = normalize(value).replace(/^#/, '');
  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) {
    const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16);
    const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16);
    const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16);
    return [r, g, b];
  }
  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
};

const parseRgbColor = (value: string): [number, number, number] | null => {
  const match = normalize(value).match(/^rgba?\(([^)]+)\)$/i);
  if (!match?.[1]) {
    return null;
  }
  const [rRaw, gRaw, bRaw] = match[1].split(',').map((part) => part.trim());
  if (!rRaw || !gRaw || !bRaw) {
    return null;
  }
  const r = Number.parseInt(rRaw, 10);
  const g = Number.parseInt(gRaw, 10);
  const b = Number.parseInt(bRaw, 10);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
};

const parseColor = (value: string): [number, number, number] | null => {
  return parseHexColor(value) ?? parseRgbColor(value);
};

const toClosestTldrawColor = (value: string, fallback: TldrawColorName): TldrawColorName => {
  const normalized = normalize(value);
  if (normalized in NAMED_COLOR_OVERRIDES) {
    return NAMED_COLOR_OVERRIDES[normalized]!;
  }
  const parsed = parseColor(value);
  if (!parsed) {
    return fallback;
  }

  let best = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of TL_COLOR_PALETTE) {
    const dr = candidate.rgb[0] - parsed[0];
    const dg = candidate.rgb[1] - parsed[1];
    const db = candidate.rgb[2] - parsed[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate.name;
    }
  }
  return best;
};

const toDashStyle = (roughness: number | undefined): TldrawDashStyle => {
  if (typeof roughness === 'number' && roughness > 0.75) {
    return 'draw';
  }
  return 'solid';
};

const toSizeFromStrokeWidth = (strokeWidth: number | undefined): TldrawSizeStyle => {
  if (typeof strokeWidth !== 'number' || !Number.isFinite(strokeWidth)) {
    return 'm';
  }
  if (strokeWidth <= 1.25) {
    return 's';
  }
  if (strokeWidth <= 2.8) {
    return 'm';
  }
  if (strokeWidth <= 4.5) {
    return 'l';
  }
  return 'xl';
};

const toSizeFromFont = (fontSize: number | undefined): TldrawSizeStyle => {
  if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) {
    return 's';
  }
  if (fontSize <= 18) {
    return 's';
  }
  if (fontSize <= 30) {
    return 'm';
  }
  return 'l';
};

const toTextWidth = (text: string): number => {
  const characters = Math.max(10, text.trim().length);
  return Math.max(120, Math.min(420, Math.round(characters * 7.8)));
};

const normalizeTextForLayout = (value: string): string => {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
};

const clampTextToLines = (lines: string[], maxLines: number): string[] => {
  if (lines.length <= maxLines) {
    return lines;
  }
  const next = lines.slice(0, Math.max(1, maxLines));
  const lastIndex = next.length - 1;
  if (lastIndex >= 0) {
    const base = next[lastIndex]!.trim();
    next[lastIndex] = `${base.slice(0, Math.max(0, base.length - 3)).trimEnd()}...`;
  }
  return next;
};

const wrapTextLine = (line: string, maxCharsPerLine: number): string[] => {
  if (line.length <= maxCharsPerLine) {
    return [line];
  }

  const words = line.split(' ').filter((word) => word.length > 0);
  const wrapped: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim().length > 0) {
      wrapped.push(current.trim());
      current = '';
    }
  };

  for (let index = 0; index < words.length; index += 1) {
    let word = words[index]!;
    while (word.length > maxCharsPerLine) {
      const head = word.slice(0, Math.max(1, maxCharsPerLine - 1));
      word = word.slice(head.length);
      if (current.length > 0) {
        pushCurrent();
      }
      wrapped.push(`${head}-`);
    }

    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine) {
      pushCurrent();
      current = word;
    } else {
      current = candidate;
    }
  }

  pushCurrent();
  return wrapped.length > 0 ? wrapped : [line];
};

const wrapTextToShape = (
  value: string,
  width: number,
  size: TldrawSizeStyle,
  maxLines: number,
): string => {
  const normalized = normalizeTextForLayout(value);
  if (!normalized) {
    return '';
  }

  const approxFontPx = SIZE_TO_APPROX_FONT_PX[size];
  const approxCharWidth = Math.max(7, Math.round(approxFontPx * 0.54));
  const maxCharsPerLine = Math.max(10, Math.floor(Math.max(80, width) / approxCharWidth));

  const paragraphLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const wrapped: string[] = [];
  for (let index = 0; index < paragraphLines.length; index += 1) {
    wrapped.push(...wrapTextLine(paragraphLines[index]!, maxCharsPerLine));
  }

  const clamped = clampTextToLines(wrapped, Math.max(1, maxLines));
  return clamped.join('\n');
};

const maxLinesForHeight = (height: number, size: TldrawSizeStyle): number => {
  const approxFontPx = SIZE_TO_APPROX_FONT_PX[size];
  const lineHeight = Math.max(16, Math.round(approxFontPx * 1.25));
  const contentHeight = Math.max(24, height - 18);
  return Math.max(1, Math.floor(contentHeight / lineHeight));
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (min > max) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

interface GuardBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxWidth: number;
  maxHeight: number;
}

const CANVAS_ELEMENT_BOUNDS: GuardBounds = {
  minX: SENSEBOARD_CANVAS_PADDING,
  maxX: SENSEBOARD_CANVAS_WIDTH - SENSEBOARD_CANVAS_PADDING,
  minY: SENSEBOARD_CANVAS_PADDING,
  maxY: SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING,
  maxWidth: Math.max(1, SENSEBOARD_CANVAS_WIDTH - SENSEBOARD_CANVAS_PADDING * 2),
  maxHeight: Math.max(1, SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING * 2),
};

const AI_MIN_X = clampNumber(SENSEBOARD_AI_CONTENT_MIN_X, CANVAS_ELEMENT_BOUNDS.minX, CANVAS_ELEMENT_BOUNDS.maxX - 1);
const AI_MAX_X = clampNumber(SENSEBOARD_AI_CONTENT_MAX_X, AI_MIN_X + 1, CANVAS_ELEMENT_BOUNDS.maxX);

const AI_ELEMENT_BOUNDS: GuardBounds = {
  minX: AI_MIN_X,
  maxX: AI_MAX_X,
  minY: CANVAS_ELEMENT_BOUNDS.minY,
  maxY: CANVAS_ELEMENT_BOUNDS.maxY,
  maxWidth: Math.max(1, Math.min(SENSEBOARD_AI_ELEMENT_MAX_WIDTH, AI_MAX_X - AI_MIN_X)),
  maxHeight: Math.max(1, Math.min(SENSEBOARD_AI_ELEMENT_MAX_HEIGHT, CANVAS_ELEMENT_BOUNDS.maxHeight)),
};

const MAX_TEXT_LENGTH = 4000;
const MAX_MOVE_DELTA = SENSEBOARD_CANVAS_WIDTH;
const MIN_VIEWPORT_ZOOM = 0.05;
const MAX_VIEWPORT_ZOOM = 6;
const DEFAULT_PROVIDER_TAG = 'unknown-provider';
const DEFAULT_BURST_WINDOW_MS = 2500;
const DEFAULT_BURST_THRESHOLD = 3;

interface ClampCounter {
  count: number;
}

interface ClampBoardOpResult {
  op: BoardOp;
  clamped: number;
  skippedChildren: number;
}

export interface BoardOpsGuardTelemetry {
  providerTag: string;
  schemaVersion: number;
  receivedOps: number;
  forwardedOps: number;
  skippedOps: number;
  clampedOps: number;
  clampReasons: string[];
  skipReasons: Record<string, number>;
  fallbackApplied: boolean;
  fallbackReason: string | null;
  burstCount: number;
  burstKey: string;
}

interface BoardOpsGuardNotice {
  kind: 'board_ops_guard';
  message: string;
  telemetry: BoardOpsGuardTelemetry;
}

type BoardOpsGuardLogger = (entry: { severity: 'debug' | 'info' | 'warn'; message: string; telemetry: BoardOpsGuardTelemetry }) => void;

export interface BoardOpsGuardOptions {
  providerTag?: string;
  burstKey?: string;
  now?: number;
  burstThreshold?: number;
  burstWindowMs?: number;
  logger?: BoardOpsGuardLogger;
  onNotice?: (notice: BoardOpsGuardNotice) => void;
}

export interface BoardOpsGuardResult {
  ops: BoardOp[];
  telemetry: BoardOpsGuardTelemetry;
  fallbackApplied: boolean;
}

interface BurstTrackerState {
  count: number;
  lastTimestamp: number;
}

const transcriptBurstHistory = new Map<string, BurstTrackerState>();
const MAX_BURST_HISTORY_ENTRIES = 64;
const BURST_RETENTION_MULTIPLIER = 4;
const MIN_BURST_RETENTION_MS = 10_000;

const pruneTranscriptBurstHistory = (now: number, retentionMs: number) => {
  if (transcriptBurstHistory.size === 0) {
    return;
  }
  const expiration = now - retentionMs;
  for (const [key, state] of transcriptBurstHistory) {
    if (state.lastTimestamp < expiration) {
      transcriptBurstHistory.delete(key);
    }
  }
  if (transcriptBurstHistory.size <= MAX_BURST_HISTORY_ENTRIES) {
    return;
  }
  const entries = Array.from(transcriptBurstHistory.entries()).sort(
    (left, right) => left[1].lastTimestamp - right[1].lastTimestamp,
  );
  for (let index = 0; index < entries.length - MAX_BURST_HISTORY_ENTRIES; index += 1) {
    const [key] = entries[index]!;
    transcriptBurstHistory.delete(key);
  }
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const sanitizeBoardText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/\r\n/g, '\n');
  if (normalized.trim().length === 0) {
    return null;
  }
  return normalized.slice(0, MAX_TEXT_LENGTH);
};

const registerSkipReason = (skipReasons: Map<string, number>, reason: string) => {
  skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
};

const clampNumericValue = (
  value: unknown,
  min: number,
  max: number,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
  fallback?: number,
): number => {
  const numeric = isFiniteNumber(value) ? value : fallback ?? min;
  const clamped = clampNumber(numeric, min, max);
  if (clamped !== numeric || numeric !== value) {
    clampReasons.add(reason);
    counter.count += 1;
  }
  return clamped;
};

const clampPointWithinBounds = (
  point: unknown,
  bounds: GuardBounds,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
): BoardPoint | null => {
  if (!Array.isArray(point) || point.length < 2) {
    clampReasons.add(`${reason}:invalid_point`);
    counter.count += 1;
    return null;
  }
  const [xRaw, yRaw] = point;
  const xNumeric = isFiniteNumber(xRaw) ? xRaw : bounds.minX;
  const yNumeric = isFiniteNumber(yRaw) ? yRaw : bounds.minY;
  const x = clampNumber(xNumeric, bounds.minX, bounds.maxX);
  const y = clampNumber(yNumeric, bounds.minY, bounds.maxY);
  if (x !== xNumeric || xNumeric !== xRaw) {
    clampReasons.add(`${reason}:x`);
    counter.count += 1;
  }
  if (y !== yNumeric || yNumeric !== yRaw) {
    clampReasons.add(`${reason}:y`);
    counter.count += 1;
  }
  return [x, y];
};

const clampStrokePoints = (
  points: unknown,
  bounds: GuardBounds,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
): BoardPoint[] => {
  if (!Array.isArray(points)) {
    return [];
  }
  const sanitized: BoardPoint[] = [];
  for (const entry of points) {
    const clamped = clampPointWithinBounds(entry, bounds, reason, clampReasons, counter);
    if (clamped) {
      sanitized.push(clamped);
    }
  }
  return sanitized;
};

const clampBoardElementForOps = (
  element: BoardElement | null | undefined,
  clampReasons: Set<string>,
): { element: BoardElement; clamped: number } | null => {
  if (!element || typeof element.id !== 'string' || element.id.trim().length === 0) {
    return null;
  }
  const createdBy = element.createdBy === 'system' ? 'system' : 'ai';
  const createdAt = isFiniteNumber(element.createdAt) ? element.createdAt : deterministicTimestampFromSeed(element.id);
  const bounds = createdBy === 'ai' ? AI_ELEMENT_BOUNDS : CANVAS_ELEMENT_BOUNDS;
  const yMax = bounds.maxY;
  const counter: ClampCounter = { count: 0 };

  const clampRectLike = <T extends { x: number; y: number; w: number; h: number }>(
    target: T,
    prefix: string,
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

  if (element.kind === 'text') {
    const text = sanitizeBoardText(element.text);
    if (!text) {
      clampReasons.add('upsert:text_empty');
      return null;
    }
    const x = clampNumericValue(element.x, bounds.minX, bounds.maxX, 'upsert:text_x', clampReasons, counter);
    const y = clampNumericValue(element.y, bounds.minY, yMax, 'upsert:text_y', clampReasons, counter);
    return {
      element: {
        ...element,
        text,
        x,
        y,
        createdAt,
        createdBy,
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
    const rect = clampRectLike(element, prefix);
    if (element.kind === 'sticky') {
      const text = typeof element.text === 'string' ? element.text.slice(0, MAX_TEXT_LENGTH) : '';
      return {
        element: {
          ...rect,
          text,
          createdAt,
          createdBy,
        } as BoardElement,
        clamped: counter.count,
      };
    }
    if (element.kind === 'frame' && typeof element.title === 'string') {
      rect.title = element.title.slice(0, MAX_TEXT_LENGTH);
    }
    return {
      element: {
        ...rect,
        createdAt,
        createdBy,
      } as BoardElement,
      clamped: counter.count,
    };
  }

  if (element.kind === 'line' || element.kind === 'stroke' || element.kind === 'arrow') {
    const points = clampStrokePoints(element.points, CANVAS_ELEMENT_BOUNDS, `upsert:${element.kind}_points`, clampReasons, counter);
    if (points.length < 2) {
      clampReasons.add(`upsert:${element.kind}_insufficient_points`);
      return null;
    }
    return {
      element: {
        ...element,
        points,
        createdAt,
        createdBy,
      },
      clamped: counter.count,
    };
  }

  return null;
};

const clampStylePatch = (
  style: unknown,
  clampReasons: Set<string>,
  counter: ClampCounter,
): Partial<BoardElementStyle> => {
  if (!style || typeof style !== 'object') {
    return {};
  }
  const next: Partial<BoardElementStyle> = {};
  const recordClamp = (reason: string) => {
    clampReasons.add(reason);
    counter.count += 1;
  };
  if (typeof (style as BoardElementStyle).strokeColor === 'string') {
    const original = (style as BoardElementStyle).strokeColor;
    const sanitized = original.slice(0, 64);
    if (sanitized !== original) {
      recordClamp('style:strokeColor');
    }
    next.strokeColor = sanitized;
  }
  if (typeof (style as BoardElementStyle).fillColor === 'string') {
    const original = (style as BoardElementStyle).fillColor;
    const sanitized = original.slice(0, 64);
    if (sanitized !== original) {
      recordClamp('style:fillColor');
    }
    next.fillColor = sanitized;
  }
  if (isFiniteNumber((style as BoardElementStyle).strokeWidth)) {
    next.strokeWidth = clampNumericValue(
      (style as BoardElementStyle).strokeWidth ?? 1,
      0.2,
      32,
      'style:strokeWidth',
      clampReasons,
      counter,
      1,
    );
  }
  if (isFiniteNumber((style as BoardElementStyle).roughness)) {
    next.roughness = clampNumericValue(
      (style as BoardElementStyle).roughness ?? 0,
      0,
      2,
      'style:roughness',
      clampReasons,
      counter,
      0,
    );
  }
  if (isFiniteNumber((style as BoardElementStyle).fontSize)) {
    next.fontSize = clampNumericValue(
      (style as BoardElementStyle).fontSize ?? 16,
      8,
      120,
      'style:fontSize',
      clampReasons,
      counter,
      16,
    );
  }
  return next;
};

const clampSingleBoardOp = (
  op: BoardOp | null | undefined,
  clampReasons: Set<string>,
  skipReasons: Map<string, number>,
): ClampBoardOpResult | null => {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    registerSkipReason(skipReasons, 'op:invalid');
    return null;
  }

  if (op.type === 'upsertElement') {
    const result = clampBoardElementForOps(op.element, clampReasons);
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
    if (op.x !== undefined) {
      patch.x = clampNumericValue(op.x, CANVAS_ELEMENT_BOUNDS.minX, CANVAS_ELEMENT_BOUNDS.maxX, 'geometry:x', clampReasons, counter);
      mutated = true;
    }
    if (op.y !== undefined) {
      patch.y = clampNumericValue(op.y, CANVAS_ELEMENT_BOUNDS.minY, CANVAS_ELEMENT_BOUNDS.maxY, 'geometry:y', clampReasons, counter);
      mutated = true;
    }
    if (op.w !== undefined) {
      patch.w = clampNumericValue(op.w, 1, CANVAS_ELEMENT_BOUNDS.maxWidth, 'geometry:w', clampReasons, counter);
      mutated = true;
    }
    if (op.h !== undefined) {
      patch.h = clampNumericValue(op.h, 1, CANVAS_ELEMENT_BOUNDS.maxHeight, 'geometry:h', clampReasons, counter);
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
    const dx = isFiniteNumber(op.dx) ? clampNumber(op.dx, -MAX_MOVE_DELTA, MAX_MOVE_DELTA) : 0;
    const dy = isFiniteNumber(op.dy) ? clampNumber(op.dy, -MAX_MOVE_DELTA, MAX_MOVE_DELTA) : 0;
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
    const text = sanitizeBoardText(op.text);
    if (!text) {
      registerSkipReason(skipReasons, 'text:empty');
      return null;
    }
    return {
      op: { type: 'setElementText', id: op.id, text },
      clamped: 0,
      skippedChildren: 0,
    };
  }

  if (op.type === 'setElementStyle') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0) {
      registerSkipReason(skipReasons, 'style:id');
      return null;
    }
    const counter: ClampCounter = { count: 0 };
    const style = clampStylePatch(op.style, clampReasons, counter);
    if (Object.keys(style).length === 0) {
      registerSkipReason(skipReasons, 'style:empty');
      return null;
    }
    return {
      op: { type: 'setElementStyle', id: op.id, style },
      clamped: counter.count,
      skippedChildren: 0,
    };
  }

  if (op.type === 'duplicateElement') {
    if (typeof op.id !== 'string' || op.id.trim().length === 0 || typeof op.newId !== 'string' || op.newId.trim().length === 0) {
      registerSkipReason(skipReasons, 'duplicate:id');
      return null;
    }
    const dx = isFiniteNumber(op.dx) ? clampNumber(op.dx, -MAX_MOVE_DELTA, MAX_MOVE_DELTA) : 24;
    const dy = isFiniteNumber(op.dy) ? clampNumber(op.dy, -MAX_MOVE_DELTA, MAX_MOVE_DELTA) : 24;
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
    const zIndex = Math.round(clampNumber(op.zIndex, -100000, 100000));
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
      gap = clampNumber(isFiniteNumber(op.gap) ? op.gap : 0, -MAX_MOVE_DELTA, MAX_MOVE_DELTA);
      if (gap !== op.gap) {
        clampReasons.add('distribute:gap');
        clamped += 1;
      }
    }
    return {
      op: gap === undefined ? { type: 'distributeElements', ids, axis } : { type: 'distributeElements', ids, axis, gap },
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
      nextViewport.x = clampNumericValue(viewport.x, CANVAS_ELEMENT_BOUNDS.minX, CANVAS_ELEMENT_BOUNDS.maxX, 'viewport:x', clampReasons, counter, CANVAS_ELEMENT_BOUNDS.minX);
      mutated = true;
    }
    if (viewport.y !== undefined) {
      nextViewport.y = clampNumericValue(viewport.y, CANVAS_ELEMENT_BOUNDS.minY, CANVAS_ELEMENT_BOUNDS.maxY, 'viewport:y', clampReasons, counter, CANVAS_ELEMENT_BOUNDS.minY);
      mutated = true;
    }
    if (viewport.zoom !== undefined) {
      nextViewport.zoom = clampNumericValue(viewport.zoom, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM, 'viewport:zoom', clampReasons, counter, 1);
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
      const nestedResult = clampSingleBoardOp(nested as BoardOp, clampReasons, skipReasons);
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

  return {
    op,
    clamped: 0,
    skippedChildren: 0,
  };
};

const trackTranscriptBurst = (
  key: string,
  invalidPayload: boolean,
  now: number,
  threshold: number,
  windowMs: number,
): { burstCount: number; triggered: boolean } => {
  const retentionWindow = Math.max(windowMs * BURST_RETENTION_MULTIPLIER, MIN_BURST_RETENTION_MS);
  pruneTranscriptBurstHistory(now, retentionWindow);
  if (!invalidPayload) {
    transcriptBurstHistory.set(key, { count: 0, lastTimestamp: now });
    pruneTranscriptBurstHistory(now, retentionWindow);
    return { burstCount: 0, triggered: false };
  }
  const previous = transcriptBurstHistory.get(key);
  const withinWindow = previous && now - previous.lastTimestamp <= windowMs;
  const nextCount = withinWindow ? (previous?.count ?? 0) + 1 : 1;
  transcriptBurstHistory.set(key, { count: nextCount, lastTimestamp: now });
  pruneTranscriptBurstHistory(now, retentionWindow);
  return { burstCount: nextCount, triggered: nextCount >= threshold };
};

const defaultGuardLogger: BoardOpsGuardLogger = (entry) => {
  const target =
    entry.severity === 'warn' ? console.warn : entry.severity === 'info' ? console.info : console.debug;
  target('[board_ops_guard]', entry.message, entry.telemetry);
};

const defaultHostNoticeEmitter = (notice: BoardOpsGuardNotice) => {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const event =
        typeof CustomEvent === 'function'
          ? new CustomEvent('senseboard:host-notice', { detail: notice })
          : new Event('senseboard:host-notice');
      window.dispatchEvent(event);
    } catch {
      // Swallow errors when the environment does not support CustomEvent.
    }
  }
  console.warn('[host-notice]', notice.message, notice.telemetry);
};

const hashSeed = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const DETERMINISTIC_FALLBACK_EPOCH_MS = 1_700_000_000_000;

const deterministicTimestampFromSeed = (seed: string, offset = 0): number => {
  const hash = hashSeed(`${seed}:${offset}`);
  return DETERMINISTIC_FALLBACK_EPOCH_MS + (hash % 1_000_000);
};

const buildDeterministicFallbackOps = (seed: string): BoardOp[] => {
  const hash = hashSeed(seed);
  const laneWidth = Math.max(1, AI_ELEMENT_BOUNDS.maxX - AI_ELEMENT_BOUNDS.minX);
  const laneOffset = hash % laneWidth;
  const baseX = clampNumber(AI_ELEMENT_BOUNDS.minX + 40 + laneOffset, AI_ELEMENT_BOUNDS.minX + 40, AI_ELEMENT_BOUNDS.maxX - 240);
  const baseY = clampNumber(CANVAS_ELEMENT_BOUNDS.minY + 120 + (hash % 200), CANVAS_ELEMENT_BOUNDS.minY + 80, CANVAS_ELEMENT_BOUNDS.maxY - 240);
  const connectorEndX = clampNumber(baseX + 320, AI_ELEMENT_BOUNDS.minX + 120, AI_ELEMENT_BOUNDS.maxX - 40);
  const fallbackTimestamp = deterministicTimestampFromSeed(`${seed}:fallback`);

  const fallbackElements: BoardElement[] = [
    {
      id: `guard:text:${seed}`,
      kind: 'text',
      x: baseX,
      y: baseY,
      text: 'Capturing the spoken flow while board ops stabilize.',
      createdAt: fallbackTimestamp,
      createdBy: 'ai',
    },
    {
      id: `guard:connector:${seed}`,
      kind: 'arrow',
      points: [
        [baseX + 40, baseY + 120],
        [connectorEndX, baseY + 120],
      ],
      createdAt: fallbackTimestamp + 1,
      createdBy: 'ai',
    },
    {
      id: `guard:note:${seed}`,
      kind: 'text',
      x: connectorEndX - 40,
      y: baseY + 96,
      text: 'Placeholder connectors rendered deterministically.',
      createdAt: fallbackTimestamp + 2,
      createdBy: 'ai',
    },
  ];

  return fallbackElements.map<BoardOp>((element) => ({ type: 'upsertElement', element }));
};

export const guardBoardOpsEnvelope = (
  envelope: BoardOpsEnvelope | null | undefined,
  options?: BoardOpsGuardOptions,
): BoardOpsGuardResult => {
  const providerTag = options?.providerTag ?? DEFAULT_PROVIDER_TAG;
  const burstKey = options?.burstKey ?? providerTag;
  const now = options?.now ?? Date.now();
  const logger = options?.logger ?? defaultGuardLogger;
  const noticeEmitter = options?.onNotice ?? defaultHostNoticeEmitter;
  const rawOps = Array.isArray(envelope?.ops) ? envelope!.ops : [];
  const clampReasons = new Set<string>();
  const skipReasons = new Map<string, number>();

  const sanitizedOps: BoardOp[] = [];
  let clampedFields = 0;
  let skippedTopLevel = 0;
  let skippedNested = 0;

  for (const raw of rawOps) {
    const result = clampSingleBoardOp(raw as BoardOp, clampReasons, skipReasons);
    if (result) {
      sanitizedOps.push(result.op);
      clampedFields += result.clamped;
      skippedNested += result.skippedChildren;
    } else {
      skippedTopLevel += 1;
    }
  }

  const { burstCount, triggered } = trackTranscriptBurst(
    burstKey,
    sanitizedOps.length === 0,
    now,
    options?.burstThreshold ?? DEFAULT_BURST_THRESHOLD,
    options?.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS,
  );

  let fallbackApplied = false;
  let fallbackReason: string | null = null;
  let forwardedOps = sanitizedOps;

  if (sanitizedOps.length === 0) {
    fallbackApplied = true;
    fallbackReason = triggered
      ? 'transcript_burst'
      : rawOps.length === 0
        ? 'empty_payload'
        : 'invalid_ops';
    const fallbackSeed = `${burstKey}:${fallbackReason}`;
    forwardedOps = buildDeterministicFallbackOps(fallbackSeed);
    clampReasons.add(`fallback:${fallbackReason}`);
  }

  const skipReasonsRecord = Object.fromEntries(skipReasons.entries());
  const telemetry: BoardOpsGuardTelemetry = {
    providerTag,
    schemaVersion: envelope?.schemaVersion ?? 0,
    receivedOps: rawOps.length,
    forwardedOps: forwardedOps.length,
    skippedOps: skippedTopLevel + skippedNested,
    clampedOps: clampedFields,
    clampReasons: Array.from(clampReasons).sort(),
    skipReasons: skipReasonsRecord,
    fallbackApplied,
    fallbackReason,
    burstCount,
    burstKey,
  };

  const guardIntervened = fallbackApplied || telemetry.clampedOps > 0 || telemetry.skippedOps > 0;
  if (guardIntervened) {
    const severity: 'warn' | 'info' | 'debug' = fallbackApplied ? 'warn' : telemetry.clampedOps > 0 ? 'info' : 'debug';
    const message = fallbackApplied
      ? `Fallback board_ops (${fallbackReason ?? 'unknown'}) applied for provider=${providerTag}; burstCount=${burstCount}.`
      : `Sanitized ${telemetry.clampedOps} board_ops fields for provider=${providerTag}.`;
    logger({ severity, message, telemetry });
    noticeEmitter({
      kind: 'board_ops_guard',
      message: fallbackApplied
        ? fallbackReason === 'transcript_burst'
          ? 'Rendered deterministic connectors while AI recovers.'
          : fallbackReason === 'empty_payload'
            ? 'Rendered deterministic placeholders while waiting for board ops.'
            : 'Rendered deterministic placeholders after sanitizing board ops.'
        : 'Board ops sanitized before rendering.',
      telemetry,
    });
  } else if (options?.logger) {
    logger({ severity: 'debug', message: `Board ops guard pass-through for provider=${providerTag}.`, telemetry });
  }

  return {
    ops: forwardedOps,
    telemetry,
    fallbackApplied,
  };
};

const isContainerElement = (
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

const toContainerBounds = (element: BoardElement): TextContainerBounds | null => {
  if (!isContainerElement(element)) {
    return null;
  }
  return {
    x: element.x,
    y: element.y,
    w: Math.max(1, element.w),
    h: Math.max(1, element.h),
  };
};

const findContainingTextBounds = (
  element: Extract<BoardElement, { kind: 'text' }>,
  containers: TextContainerBounds[],
): TextContainerBounds | null => {
  let best: TextContainerBounds | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let index = 0; index < containers.length; index += 1) {
    const container = containers[index]!;
    const padding = 4;
    const insideX = element.x >= container.x + padding && element.x <= container.x + container.w - padding;
    const insideY = element.y >= container.y + padding && element.y <= container.y + container.h - padding;
    if (!insideX || !insideY) {
      continue;
    }
    const area = container.w * container.h;
    if (area < bestArea) {
      bestArea = area;
      best = container;
    }
  }

  return best;
};

const toRelativeLinePoints = (points: BoardPoint[]): { x: number; y: number; points: TldrawDraftPoint[] } | null => {
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  if (!first) {
    return null;
  }
  const [originX, originY] = first;
  const relativePoints: TldrawDraftPoint[] = points.map((point, index) => {
    const [x, y] = point;
    return {
      id: `p${index.toString(36)}`,
      index: `a${index.toString(36)}`,
      x: x - originX,
      y: y - originY,
    };
  });

  return { x: originX, y: originY, points: relativePoints };
};

const getOrderedElements = (board: BoardState): BoardElement[] => {
  const seen = new Set<string>();
  const ordered = board.order
    .map((id) => {
      seen.add(id);
      return board.elements[id];
    })
    .filter((element): element is BoardElement => Boolean(element));

  const extras = Object.values(board.elements)
    .filter((element) => !seen.has(element.id))
    .sort((left, right) => left.createdAt - right.createdAt);

  return [...ordered, ...extras];
};

const shouldHideAiText = (id: string, showAiNotes: boolean): boolean => {
  if (showAiNotes) {
    return false;
  }
  return id.startsWith('notes:') || id.startsWith('order:');
};

const toSafeShapeKey = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }

  const prefix = normalized
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  const safePrefix = prefix || 'shape';
  return `sense-${safePrefix}-${hash.toString(36)}`;
};

const toFillStyle = (fillColor: string | undefined): TldrawFillStyle => {
  const normalized = normalize(fillColor ?? '');
  if (TRANSPARENT_VALUES.has(normalized)) {
    return 'none';
  }
  return 'solid';
};

const toDraftShape = (
  element: BoardElement,
  orderIndex: number,
  showAiNotes: boolean,
  textContainers: TextContainerBounds[],
): TldrawDraftShape | null => {
  const strokeColor = element.style?.strokeColor;
  const fillColor = element.style?.fillColor;
  const strokeWidth = element.style?.strokeWidth;
  const roughness = element.style?.roughness;
  const fontSize = element.style?.fontSize;
  const zIndex = element.zIndex ?? orderIndex;
  const safeId = toSafeShapeKey(element.id);

  if (element.kind === 'text') {
    if (shouldHideAiText(element.id, showAiNotes)) {
      return null;
    }
    const textSize = toSizeFromFont(fontSize);
    const container = findContainingTextBounds(element, textContainers);
    const width =
      container !== null ? clampNumber(container.w - 24, 110, 460) : toTextWidth(element.text);
    const maxLines = container !== null ? maxLinesForHeight(container.h - 10, textSize) : 6;
    const wrappedText = wrapTextToShape(element.text, width, textSize, maxLines);
    const x =
      container !== null
        ? clampNumber(element.x, container.x + 10, container.x + Math.max(10, container.w - width - 10))
        : element.x;
    const y =
      container !== null
        ? clampNumber(element.y, container.y + 10, container.y + Math.max(10, container.h - 28))
        : element.y;
    return {
      kind: 'text',
      id: safeId,
      x,
      y,
      zIndex,
      props: {
        text: wrappedText,
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
        size: textSize,
        w: width,
        autoSize: false,
      },
    };
  }

  if (element.kind === 'rect' || element.kind === 'ellipse' || element.kind === 'diamond' || element.kind === 'triangle') {
    const geo: TldrawDraftGeoShape['props']['geo'] =
      element.kind === 'rect'
        ? 'rectangle'
        : element.kind === 'ellipse'
          ? 'ellipse'
          : element.kind === 'diamond'
            ? 'diamond'
            : 'triangle';

    return {
      kind: 'geo',
      id: safeId,
      x: element.x,
      y: element.y,
      zIndex,
      props: {
        geo,
        w: Math.max(4, element.w),
        h: Math.max(4, element.h),
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
        labelColor: toClosestTldrawColor(strokeColor ?? '', 'black'),
        fill: toFillStyle(fillColor),
        size: toSizeFromStrokeWidth(strokeWidth),
        dash: toDashStyle(roughness),
        text: '',
        align: 'middle',
        verticalAlign: 'middle',
      },
    };
  }

  if (element.kind === 'sticky') {
    const textSize = toSizeFromFont(fontSize);
    const width = Math.max(24, element.w);
    const height = Math.max(24, element.h);
    const wrappedText = wrapTextToShape(element.text, width - 18, textSize, maxLinesForHeight(height, textSize));
    return {
      kind: 'geo',
      id: safeId,
      x: element.x,
      y: element.y,
      zIndex,
      props: {
        geo: 'rectangle',
        w: width,
        h: height,
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
        labelColor: toClosestTldrawColor(strokeColor ?? '', 'black'),
        fill: 'solid',
        size: textSize,
        dash: toDashStyle(roughness),
        text: wrappedText,
        align: 'start',
        verticalAlign: 'start',
      },
    };
  }

  if (element.kind === 'frame') {
    return {
      kind: 'frame',
      id: safeId,
      x: element.x,
      y: element.y,
      zIndex,
      props: {
        w: Math.max(24, element.w),
        h: Math.max(24, element.h),
        name: element.title || 'Frame',
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
      },
    };
  }

  if (element.kind === 'line' || element.kind === 'stroke') {
    const line = toRelativeLinePoints(element.points);
    if (!line) {
      return null;
    }
    return {
      kind: 'line',
      id: safeId,
      x: line.x,
      y: line.y,
      zIndex,
      props: {
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
        dash: toDashStyle(roughness),
        size: toSizeFromStrokeWidth(strokeWidth),
        spline: element.kind === 'stroke' ? 'cubic' : 'line',
        points: line.points,
      },
    };
  }

  if (element.kind === 'arrow') {
    const first = element.points[0];
    const last = element.points[element.points.length - 1];
    if (!first || !last) {
      return null;
    }
    return {
      kind: 'arrow',
      id: safeId,
      x: first[0],
      y: first[1],
      zIndex,
      props: {
        kind: 'arc',
        color: toClosestTldrawColor(strokeColor ?? '', 'black'),
        fill: 'none',
        dash: toDashStyle(roughness),
        size: toSizeFromStrokeWidth(strokeWidth),
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        start: { x: 0, y: 0 },
        end: {
          x: last[0] - first[0],
          y: last[1] - first[1],
        },
      },
    };
  }

  return null;
};

export const boardToTldrawDraftShapes = (
  board: BoardState | null | undefined,
  showAiNotes: boolean,
): TldrawDraftShape[] => {
  if (!board) {
    return [];
  }

  const ordered = getOrderedElements(board);
  const textContainers = ordered
    .map((element) => toContainerBounds(element))
    .filter((value): value is TextContainerBounds => value !== null)
    .sort((left, right) => left.w * left.h - right.w * right.h);
  const drafts = ordered
    .map((element, orderIndex) => toDraftShape(element, orderIndex, showAiNotes, textContainers))
    .filter((shape): shape is TldrawDraftShape => Boolean(shape));

  drafts.sort((left, right) => left.zIndex - right.zIndex);
  return drafts;
};

export const __testInternals = {
  clampSingleBoardOp,
  resetTranscriptBurstHistory: (): void => {
    transcriptBurstHistory.clear();
  },
  getTranscriptBurstHistorySize: (): number => transcriptBurstHistory.size,
  burstHistoryLimit: MAX_BURST_HISTORY_ENTRIES,
} as const;
