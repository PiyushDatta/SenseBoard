import {
  SENSEBOARD_AI_CONTENT_MAX_X,
  SENSEBOARD_AI_CONTENT_MIN_X,
  SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
  SENSEBOARD_AI_ELEMENT_MAX_WIDTH,
  SENSEBOARD_CANVAS_HEIGHT,
  SENSEBOARD_CANVAS_PADDING,
  SENSEBOARD_CANVAS_WIDTH,
} from '../../../shared/board-dimensions';
import type { BoardElement, BoardPoint, BoardState } from '../../../shared/types';

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

const CANVAS_MIN_X = SENSEBOARD_CANVAS_PADDING;
const CANVAS_MAX_X = SENSEBOARD_CANVAS_WIDTH - SENSEBOARD_CANVAS_PADDING;
const CANVAS_MIN_Y = SENSEBOARD_CANVAS_PADDING;
const CANVAS_MAX_Y = SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING;
const AI_LANE_MIN_X = clampNumber(SENSEBOARD_AI_CONTENT_MIN_X, CANVAS_MIN_X, CANVAS_MAX_X);
const AI_LANE_MAX_X = clampNumber(SENSEBOARD_AI_CONTENT_MAX_X, AI_LANE_MIN_X + 1, CANVAS_MAX_X);
const AI_LANE_MAX_WIDTH = Math.max(1, Math.min(AI_LANE_MAX_X - AI_LANE_MIN_X, SENSEBOARD_AI_ELEMENT_MAX_WIDTH));
const AI_LANE_MAX_HEIGHT = Math.max(1, Math.min(CANVAS_MAX_Y - CANVAS_MIN_Y, SENSEBOARD_AI_ELEMENT_MAX_HEIGHT));
const DEFAULT_GEOMETRY_WIDTH = 320;
const DEFAULT_GEOMETRY_HEIGHT = 180;
const FALLBACK_TEXT_WIDTH = 520;
const FALLBACK_MIN_TEXT_WIDTH = 200;
const FALLBACK_HORIZONTAL_MARGIN = 12;
const FALLBACK_VERTICAL_MARGIN_TOP = 20;
const FALLBACK_VERTICAL_MARGIN_BOTTOM = 40;
const FALLBACK_ROW_SPACING = 64;
const FALLBACK_COLUMN_GAP = 48;
const FALLBACK_Z_INDEX_BASE = 1000000;
const FALLBACK_TEXT_MAX_LINES = 3;

interface GeometryBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxWidth: number;
  maxHeight: number;
}

type GeometryCorrectionAction =
  | {
      type: 'clamp';
      field: 'x' | 'y' | 'w' | 'h';
      reason: 'non_finite' | 'out_of_bounds';
      from: number | null;
      to: number;
    }
  | {
      type: 'clamp_point';
      pointIndex: number;
      reason: 'out_of_bounds';
      from: [number | null, number | null];
      to: [number, number];
    }
  | {
      type: 'drop_point';
      pointIndex: number;
      reason: 'non_finite';
      from: [number | null, number | null] | null;
    }
  | {
      type: 'drop';
      reason: string;
    };

interface GeometryCorrectionEvent {
  elementId: string;
  kind: BoardElement['kind'];
  actions: GeometryCorrectionAction[];
}

type GeometryCorrectionMap = Map<string, GeometryCorrectionEvent>;

interface GeometryCorrectionSummary {
  events: number;
  clamped: number;
  clampedPoints: number;
  droppedPoints: number;
  droppedElements: number;
  fallbackDrafts: number;
}

interface GeometryCorrectionMetricPayload {
  kind: 'senseboard_geometry_correction';
  source: 'canvas-surface.tldraw-adapter';
  summary: GeometryCorrectionSummary;
  events: GeometryCorrectionEvent[];
  timestamp: number;
}

interface SenseboardTelemetrySink {
  emit: (payload: GeometryCorrectionMetricPayload) => void;
  log?: (payload: GeometryCorrectionMetricPayload) => void;
}

declare global {
  interface Window {
    senseboardTelemetry?: SenseboardTelemetrySink;
  }
}

type SanitizedElementResult =
  | { element: BoardElement; dropped: false }
  | { element: BoardElement; dropped: true; reason: string };

const safeMetricNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const recordGeometryCorrection = (map: GeometryCorrectionMap, element: BoardElement, action: GeometryCorrectionAction) => {
  let record = map.get(element.id);
  if (!record) {
    record = {
      elementId: element.id,
      kind: element.kind,
      actions: [],
    };
    map.set(element.id, record);
  }
  record.actions.push(action);
};

const getGeometryBounds = (element: BoardElement): GeometryBounds => {
  const minX = CANVAS_MIN_X;
  const maxX = CANVAS_MAX_X;
  const minY = CANVAS_MIN_Y;
  const maxY = CANVAS_MAX_Y;
  const widthLimit =
    element.createdBy === 'ai'
      ? Math.min(CANVAS_MAX_X - CANVAS_MIN_X, AI_LANE_MAX_WIDTH)
      : CANVAS_MAX_X - CANVAS_MIN_X;
  const heightLimit =
    element.createdBy === 'ai'
      ? Math.min(CANVAS_MAX_Y - CANVAS_MIN_Y, AI_LANE_MAX_HEIGHT)
      : CANVAS_MAX_Y - CANVAS_MIN_Y;
  return {
    minX,
    maxX,
    minY,
    maxY,
    maxWidth: Math.max(1, widthLimit),
    maxHeight: Math.max(1, heightLimit),
  };
};

const clampCoordinateValue = (
  element: BoardElement,
  corrections: GeometryCorrectionMap,
  field: 'x' | 'y',
  value: number,
  min: number,
  max: number,
): number => {
  const boundedMax = Math.max(min, max);
  if (!Number.isFinite(value)) {
    const fallback = min;
    recordGeometryCorrection(corrections, element, {
      type: 'clamp',
      field,
      reason: 'non_finite',
      from: safeMetricNumber(value),
      to: fallback,
    });
    return fallback;
  }
  const clamped = clampNumber(value, min, boundedMax);
  if (clamped !== value) {
    recordGeometryCorrection(corrections, element, {
      type: 'clamp',
      field,
      reason: 'out_of_bounds',
      from: safeMetricNumber(value),
      to: clamped,
    });
  }
  return clamped;
};

const clampDimensionValue = (
  element: BoardElement,
  corrections: GeometryCorrectionMap,
  field: 'w' | 'h',
  value: number,
  maxValue: number,
): number => {
  const min = 1;
  const boundedMax = Math.max(min, maxValue);
  const fallback = clampNumber(field === 'w' ? DEFAULT_GEOMETRY_WIDTH : DEFAULT_GEOMETRY_HEIGHT, min, boundedMax);
  if (!Number.isFinite(value)) {
    recordGeometryCorrection(corrections, element, {
      type: 'clamp',
      field,
      reason: 'non_finite',
      from: safeMetricNumber(value),
      to: fallback,
    });
    return fallback;
  }
  const clamped = clampNumber(value, min, boundedMax);
  if (clamped !== value) {
    recordGeometryCorrection(corrections, element, {
      type: 'clamp',
      field,
      reason: 'out_of_bounds',
      from: safeMetricNumber(value),
      to: clamped,
    });
  }
  return clamped;
};

const sanitizeBoardElementGeometry = (element: BoardElement, corrections: GeometryCorrectionMap): SanitizedElementResult => {
  const bounds = getGeometryBounds(element);

  if (element.kind === 'text') {
    const x = clampCoordinateValue(element, corrections, 'x', element.x, bounds.minX, bounds.maxX);
    const y = clampCoordinateValue(element, corrections, 'y', element.y, bounds.minY, bounds.maxY);
    return {
      element: {
        ...element,
        x,
        y,
      },
      dropped: false,
    };
  }

  if (isContainerElement(element)) {
    const w = clampDimensionValue(element, corrections, 'w', element.w, bounds.maxWidth);
    const h = clampDimensionValue(element, corrections, 'h', element.h, bounds.maxHeight);
    const x = clampCoordinateValue(element, corrections, 'x', element.x, bounds.minX, Math.max(bounds.minX, bounds.maxX - w));
    const y = clampCoordinateValue(element, corrections, 'y', element.y, bounds.minY, Math.max(bounds.minY, bounds.maxY - h));
    return {
      element: {
        ...element,
        x,
        y,
        w,
        h,
      },
      dropped: false,
    };
  }

  if (element.kind === 'stroke' || element.kind === 'line' || element.kind === 'arrow') {
    const sanitizedPoints: BoardPoint[] = [];
    for (let index = 0; index < element.points.length; index += 1) {
      const point = element.points[index];
      if (!point || point.length < 2) {
        recordGeometryCorrection(corrections, element, {
          type: 'drop_point',
          pointIndex: index,
          reason: 'non_finite',
          from: null,
        });
        continue;
      }
      const [xRaw, yRaw] = point;
      const hasFiniteX = typeof xRaw === 'number' && Number.isFinite(xRaw);
      const hasFiniteY = typeof yRaw === 'number' && Number.isFinite(yRaw);
      if (!hasFiniteX || !hasFiniteY) {
        recordGeometryCorrection(corrections, element, {
          type: 'drop_point',
          pointIndex: index,
          reason: 'non_finite',
          from: [safeMetricNumber(xRaw), safeMetricNumber(yRaw)],
        });
        continue;
      }
      const x = clampNumber(xRaw, bounds.minX, bounds.maxX);
      const y = clampNumber(yRaw, bounds.minY, bounds.maxY);
      if (x !== xRaw || y !== yRaw) {
        recordGeometryCorrection(corrections, element, {
          type: 'clamp_point',
          pointIndex: index,
          reason: 'out_of_bounds',
          from: [safeMetricNumber(xRaw), safeMetricNumber(yRaw)],
          to: [x, y],
        });
      }
      sanitizedPoints.push([x, y]);
    }

    if (sanitizedPoints.length < 2) {
      recordGeometryCorrection(corrections, element, {
        type: 'drop',
        reason: 'insufficient_points',
      });
      return { element, dropped: true, reason: 'insufficient_points' };
    }

    return {
      element: {
        ...element,
        points: sanitizedPoints,
      },
      dropped: false,
    };
  }

  return { element, dropped: false };
};

const describeFallbackReason = (value: string): string => {
  if (value === 'insufficient_points') {
    return 'insufficient geometry data';
  }
  return value.replace(/[_-]+/g, ' ');
};

const shortenElementId = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length <= 32) {
    return normalized;
  }
  return `${normalized.slice(0, 12)}...${normalized.slice(-8)}`;
};

const createGeometryFallbackDraft = (element: BoardElement, index: number, reason: string): TldrawDraftTextShape => {
  const laneWidth = Math.max(1, AI_LANE_MAX_X - AI_LANE_MIN_X);
  const maxWidth = Math.max(1, laneWidth - FALLBACK_HORIZONTAL_MARGIN * 2);
  const minWidth = Math.min(FALLBACK_MIN_TEXT_WIDTH, maxWidth);
  const width = Math.max(minWidth, Math.min(FALLBACK_TEXT_WIDTH, maxWidth));
  const verticalSpace = Math.max(
    1,
    CANVAS_MAX_Y - CANVAS_MIN_Y - (FALLBACK_VERTICAL_MARGIN_TOP + FALLBACK_VERTICAL_MARGIN_BOTTOM),
  );
  const usableRows = Math.max(1, Math.floor(verticalSpace / FALLBACK_ROW_SPACING));
  const column = Math.floor(index / usableRows);
  const row = index % usableRows;
  const minX = AI_LANE_MIN_X + FALLBACK_HORIZONTAL_MARGIN;
  const maxX = Math.max(minX, AI_LANE_MAX_X - FALLBACK_HORIZONTAL_MARGIN - width);
  const x = clampNumber(minX + column * (width + FALLBACK_COLUMN_GAP), minX, maxX);
  const minY = CANVAS_MIN_Y + FALLBACK_VERTICAL_MARGIN_TOP;
  const maxY = Math.max(minY, CANVAS_MAX_Y - FALLBACK_VERTICAL_MARGIN_BOTTOM);
  const y = clampNumber(minY + row * FALLBACK_ROW_SPACING, minY, maxY);
  const prefix = element.createdBy === 'ai' ? 'AI geometry correction' : 'Geometry correction';
  const message = `${prefix} (${element.kind} ${shortenElementId(element.id)}): ${describeFallbackReason(reason)}`;
  return {
    kind: 'text',
    id: toSafeShapeKey(`fallback:${element.id}:${index}`),
    x,
    y,
    zIndex: FALLBACK_Z_INDEX_BASE + index,
    props: {
      text: wrapTextToShape(message, width, 's', FALLBACK_TEXT_MAX_LINES),
      color: 'red',
      size: 's',
      w: width,
      autoSize: false,
    },
  };
};

const emitGeometryCorrectionMetrics = (events: GeometryCorrectionEvent[], fallbackDraftCount: number) => {
  if (events.length === 0 && fallbackDraftCount === 0) {
    return;
  }
  const summary = events.reduce<GeometryCorrectionSummary>(
    (acc, event) => {
      for (const action of event.actions) {
        if (action.type === 'clamp') {
          acc.clamped += 1;
        } else if (action.type === 'clamp_point') {
          acc.clampedPoints += 1;
        } else if (action.type === 'drop_point') {
          acc.droppedPoints += 1;
        } else if (action.type === 'drop') {
          acc.droppedElements += 1;
        }
      }
      return acc;
    },
    {
      events: events.length,
      clamped: 0,
      clampedPoints: 0,
      droppedPoints: 0,
      droppedElements: 0,
      fallbackDrafts: fallbackDraftCount,
    },
  );

  const payload: GeometryCorrectionMetricPayload = {
    kind: 'senseboard_geometry_correction',
    source: 'canvas-surface.tldraw-adapter',
    summary,
    events,
    timestamp: Date.now(),
  };

  if (typeof window !== 'undefined') {
    const telemetry = window.senseboardTelemetry;
    if (telemetry) {
      if (typeof telemetry.emit === 'function') {
        try {
          telemetry.emit(payload);
        } catch {
          /* ignore telemetry errors */
        }
      }
      if (typeof telemetry.log === 'function') {
        try {
          telemetry.log(payload);
        } catch {
          /* ignore telemetry errors */
        }
      }
    }
    if (typeof window.dispatchEvent === 'function') {
      const CustomEventCtor =
        typeof window.CustomEvent === 'function'
          ? window.CustomEvent
          : typeof CustomEvent === 'function'
            ? CustomEvent
            : null;
      if (CustomEventCtor) {
        try {
          window.dispatchEvent(new CustomEventCtor('senseboard:geometry_correction', { detail: payload }));
        } catch {
          /* ignore event errors */
        }
      }
    }
  }

  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[SenseBoard][geometry]', payload);
  }
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
  const corrections: GeometryCorrectionMap = new Map();
  const sanitizedElements: BoardElement[] = [];
  const fallbackDrafts: TldrawDraftShape[] = [];

  let fallbackIndex = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const element = ordered[index]!;
    const sanitized = sanitizeBoardElementGeometry(element, corrections);
    if (sanitized.dropped) {
      fallbackDrafts.push(createGeometryFallbackDraft(sanitized.element, fallbackIndex, sanitized.reason));
      fallbackIndex += 1;
      continue;
    }
    sanitizedElements.push(sanitized.element);
  }

  const textContainers = sanitizedElements
    .map((element) => toContainerBounds(element))
    .filter((value): value is TextContainerBounds => value !== null)
    .sort((left, right) => left.w * left.h - right.w * right.h);
  const drafts = sanitizedElements
    .map((element, orderIndex) => toDraftShape(element, orderIndex, showAiNotes, textContainers))
    .filter((shape): shape is TldrawDraftShape => Boolean(shape));

  const combinedDrafts = [...drafts, ...fallbackDrafts];
  combinedDrafts.sort((left, right) => left.zIndex - right.zIndex);

  if (corrections.size > 0) {
    emitGeometryCorrectionMetrics(Array.from(corrections.values()), fallbackDrafts.length);
  }

  return combinedDrafts;
};
