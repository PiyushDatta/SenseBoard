import type {
  BoardElement,
  BoardElementStyle,
  BoardOp,
  BoardOpsEnvelope,
  BoardPoint,
  BoardRectElement,
  BoardState,
  BoardViewport,
} from '../../../shared/types';
import { BOARD_OPS_SCHEMA_VERSION } from '../../../shared/types';

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

const deterministicCreatedAtForId = (id: string): number => {
  const normalized = id.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const MOD = 2147483647;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 131 + normalized.charCodeAt(index)) % MOD;
  }
  return hash === 0 ? normalized.length : hash;
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

const MAX_BOARD_OPS_PER_ENVELOPE = 600;
const MAX_BATCH_DEPTH = 4;
const MAX_POINTS_PER_ELEMENT = 2400;
const MAX_POINTS_PER_APPEND = 600;
const MAX_DUPLICATE_IDS_REPORTED = 32;
const MAX_TEXT_LENGTH = 2000;

type AlignAxis = Extract<BoardOp, { type: 'alignElements' }>['axis'];
type DistributeAxis = Extract<BoardOp, { type: 'distributeElements' }>['axis'];

const BOARD_ELEMENT_KINDS: ReadonlySet<BoardElement['kind']> = new Set([
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
]);

const ALIGN_AXIS_SET: ReadonlySet<AlignAxis> = new Set([
  'left',
  'center',
  'right',
  'x',
  'top',
  'middle',
  'bottom',
  'y',
]);

const DISTRIBUTE_AXIS_SET: ReadonlySet<DistributeAxis> = new Set(['horizontal', 'vertical', 'x', 'y']);

export type BoardOpsGuardFailureReason =
  | 'invalid_envelope'
  | 'schema_mismatch'
  | 'missing_ops'
  | 'empty_ops'
  | 'invalid_ops';

export interface AdapterGuardTelemetryEvent {
  category: 'canvas_surface_guard';
  guard: 'schema' | 'payload' | 'duplicate_id';
  action: 'repair' | 'reject';
  reason: string;
  provider?: string;
  source?: string;
  droppedOps?: number;
  duplicateIds?: string[];
  sample?: unknown;
  counters?: BoardOpsGuardCounters;
}

export interface BoardOpsGuardCounters {
  schemaRejections: number;
  payloadRejections: number;
  payloadRepairs: number;
  duplicateRepairs: number;
}

export interface BoardOpsGuardResult {
  ok: boolean;
  acceptedOps: BoardOp[];
  reason?: BoardOpsGuardFailureReason;
  droppedInvalidCount: number;
  droppedDuplicateCount: number;
  truncatedCount: number;
  duplicateIds: string[];
}

export interface BoardOpsGuardContext {
  provider?: string;
  source?: string;
  boardBefore?: BoardState | null;
}

export interface IncrementalBoardOpsGuard {
  readonly lastAcceptedBoard: BoardState | null;
  readonly counters: BoardOpsGuardCounters;
  snapshot: (board: BoardState | null) => void;
  recoverLastAcceptedBoard: () => BoardState | null;
  guardIncomingOps: (raw: unknown, context?: BoardOpsGuardContext) => BoardOpsGuardResult;
}

interface SanitizeContext {
  truncatedOps: number;
  truncatedPoints: number;
  textTruncations: number;
  invalidCount: number;
  invalid?: {
    reason: BoardOpsGuardFailureReason;
    detail: string;
    sample?: unknown;
  };
}

const markInvalidPayload = (context: SanitizeContext, detail: string, sample: unknown) => {
  if (!context.invalid) {
    context.invalid = {
      reason: 'invalid_ops',
      detail,
      sample,
    };
  }
  context.invalidCount += 1;
};

interface DuplicateContext {
  knownIds: Set<string>;
  seenUpsertIds: Set<string>;
  seenNewIds: Set<string>;
  duplicateIds: Set<string>;
  droppedFromDuplicates: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const toId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTextValue = (value: unknown, context?: SanitizeContext): string | null => {
  const truncate = (text: string): string => {
    if (text.length <= MAX_TEXT_LENGTH) {
      return text;
    }
    if (context) {
      context.textTruncations += 1;
    }
    return text.slice(0, MAX_TEXT_LENGTH);
  };

  if (typeof value === 'string') {
    return truncate(value);
  }
  if (typeof value === 'number') {
    return truncate(String(value));
  }
  if (Array.isArray(value)) {
    const combined = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
      .join(' ');
    if (combined.length > 0) {
      return truncate(combined);
    }
  }
  return null;
};

const toBoardPoint = (value: unknown): BoardPoint | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = toFiniteNumber(value[0]);
    const y = toFiniteNumber(value[1]);
    if (x !== null && y !== null) {
      return [x, y];
    }
  }
  if (isPlainObject(value)) {
    const x = toFiniteNumber(value.x);
    const y = toFiniteNumber(value.y);
    if (x !== null && y !== null) {
      return [x, y];
    }
  }
  return null;
};

const toBoardPoints = (value: unknown, limit: number, context?: SanitizeContext): BoardPoint[] => {
  if (!Array.isArray(value) || limit <= 0) {
    return [];
  }
  const points: BoardPoint[] = [];
  for (let index = 0; index < value.length && points.length < limit; index += 1) {
    const candidate = toBoardPoint(value[index]);
    if (candidate) {
      points.push(candidate);
    }
  }
  if (context && Array.isArray(value) && value.length > limit) {
    context.truncatedPoints += value.length - limit;
  }
  return points;
};

const toStringArray = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value) || limit <= 0) {
    return [];
  }
  const next: string[] = [];
  for (let index = 0; index < value.length && next.length < limit; index += 1) {
    const entry = value[index];
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        next.push(trimmed);
      }
    }
  }
  return next;
};

const coerceBoardElementStyle = (
  value: unknown,
  context?: SanitizeContext,
  detail?: string,
  sample?: unknown,
): BoardElementStyle | undefined => {
  if (!isPlainObject(value)) {
    if (value !== undefined && context && detail) {
      markInvalidPayload(context, detail, sample ?? value);
    }
    return undefined;
  }
  let invalid = false;
  const style: BoardElementStyle = {};
  const hasOwn = Object.prototype.hasOwnProperty;

  if (hasOwn.call(value, 'strokeColor')) {
    if (typeof value.strokeColor === 'string') {
      style.strokeColor = value.strokeColor;
    } else {
      invalid = true;
    }
  }
  if (hasOwn.call(value, 'fillColor')) {
    if (typeof value.fillColor === 'string') {
      style.fillColor = value.fillColor;
    } else {
      invalid = true;
    }
  }
  if (hasOwn.call(value, 'strokeWidth')) {
    const strokeWidth = toFiniteNumber(value.strokeWidth);
    if (strokeWidth !== null) {
      style.strokeWidth = strokeWidth;
    } else {
      invalid = true;
    }
  }
  if (hasOwn.call(value, 'roughness')) {
    const roughness = toFiniteNumber(value.roughness);
    if (roughness !== null) {
      style.roughness = roughness;
    } else {
      invalid = true;
    }
  }
  if (hasOwn.call(value, 'fontSize')) {
    const fontSize = toFiniteNumber(value.fontSize);
    if (fontSize !== null) {
      style.fontSize = fontSize;
    } else {
      invalid = true;
    }
  }

  if (invalid && context && detail) {
    markInvalidPayload(context, detail, sample ?? value);
    return undefined;
  }

  return Object.keys(style).length > 0 ? style : undefined;
};

const coerceBoardElement = (value: unknown, context: SanitizeContext): BoardElement | null => {
  if (!isPlainObject(value)) {
    markInvalidPayload(context, 'element_not_object', value);
    return null;
  }
  const id = toId(value.id);
  const kindRaw = typeof value.kind === 'string' ? (value.kind.trim().toLowerCase() as BoardElement['kind']) : null;
  if (!id || !kindRaw || !BOARD_ELEMENT_KINDS.has(kindRaw)) {
    markInvalidPayload(context, 'element_invalid_kind', value);
    return null;
  }
  const hasOwn = Object.prototype.hasOwnProperty;
  const createdAt = toFiniteNumber(value.createdAt) ?? deterministicCreatedAtForId(id);
  const createdBy = value.createdBy === 'system' ? 'system' : 'ai';
  const style =
    hasOwn.call(value, 'style') && value.style !== undefined
      ? coerceBoardElementStyle(value.style, context, 'invalid_element_style', value)
      : undefined;
  if (context.invalid) {
    return null;
  }
  const zIndexRaw = toFiniteNumber(value.zIndex);
  if (zIndexRaw === null && hasOwn.call(value, 'zIndex')) {
    markInvalidPayload(context, 'invalid_element_zindex', value);
    return null;
  }
  const base = {
    id,
    createdAt,
    createdBy,
    ...(style ? { style } : {}),
    ...(zIndexRaw !== null ? { zIndex: zIndexRaw } : {}),
  };

  if (
    kindRaw === 'rect' ||
    kindRaw === 'ellipse' ||
    kindRaw === 'diamond' ||
    kindRaw === 'triangle' ||
    kindRaw === 'sticky' ||
    kindRaw === 'frame'
  ) {
    const x = toFiniteNumber(value.x);
    const y = toFiniteNumber(value.y);
    const w = toFiniteNumber(value.w ?? value.width);
    const h = toFiniteNumber(value.h ?? value.height);
    if (x === null || y === null || w === null || h === null) {
      markInvalidPayload(context, 'invalid_element_geometry', value);
      return null;
    }
    if (kindRaw === 'sticky') {
      const rawText = value.text ?? value.label ?? value.content;
      const text = rawText === undefined ? '' : toTextValue(rawText, context);
      if (text === null) {
        markInvalidPayload(context, 'invalid_element_text', value);
        return null;
      }
      return {
        ...base,
        kind: 'sticky',
        x,
        y,
        w,
        h,
        text,
      };
    }
    if (kindRaw === 'frame') {
      const element: BoardElement & { kind: 'frame' } = {
        ...base,
        kind: 'frame',
        x,
        y,
        w,
        h,
      };
      const rawName = value.title ?? value.text ?? value.label;
      if (rawName !== undefined) {
        const name = toTextValue(rawName, context);
        if (name === null) {
          markInvalidPayload(context, 'invalid_element_text', value);
          return null;
        }
        if (name.trim().length > 0) {
          element.title = name;
        }
      }
      return element;
    }
    return {
      ...base,
      kind: kindRaw,
      x,
      y,
      w,
      h,
    } as Extract<BoardElement, { kind: 'rect' | 'ellipse' | 'diamond' | 'triangle' }>;
  }

  if (kindRaw === 'text') {
    const x = toFiniteNumber(value.x);
    const y = toFiniteNumber(value.y);
    if (x === null || y === null) {
      markInvalidPayload(context, 'invalid_element_geometry', value);
      return null;
    }
    const rawText = value.text ?? value.label ?? value.content;
    const text = rawText === undefined ? '' : toTextValue(rawText, context);
    if (text === null) {
      markInvalidPayload(context, 'invalid_element_text', value);
      return null;
    }
    return {
      ...base,
      kind: 'text',
      x,
      y,
      text,
    };
  }

  if (kindRaw === 'stroke' || kindRaw === 'line' || kindRaw === 'arrow') {
    if (!Array.isArray(value.points)) {
      markInvalidPayload(context, 'invalid_element_points', value);
      return null;
    }
    const points = toBoardPoints(value.points, MAX_POINTS_PER_ELEMENT, context);
    if (points.length < 2) {
      markInvalidPayload(context, 'invalid_element_points', value);
      return null;
    }
    return {
      ...base,
      kind: kindRaw,
      points,
    } as Extract<BoardElement, { kind: 'stroke' | 'line' | 'arrow' }>;
  }

  return null;
};

const coerceStylePatch = (
  value: unknown,
  context: SanitizeContext,
  detail: string,
  sample: unknown,
): Partial<BoardElementStyle> | null => {
  const style = coerceBoardElementStyle(value, context, detail, sample);
  return style ?? null;
};

const sanitizeViewportPatch = (value: unknown): Partial<BoardViewport> | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const viewport: Partial<BoardViewport> = {};
  const x = toFiniteNumber(value.x);
  if (x !== null) {
    viewport.x = x;
  }
  const y = toFiniteNumber(value.y);
  if (y !== null) {
    viewport.y = y;
  }
  const zoom = toFiniteNumber(value.zoom);
  if (zoom !== null) {
    viewport.zoom = zoom;
  }
  return Object.keys(viewport).length > 0 ? viewport : null;
};

const sanitizeBoardOp = (value: unknown, context: SanitizeContext, depth: number): BoardOp | null => {
  if (depth > MAX_BATCH_DEPTH) {
    markInvalidPayload(context, 'max_batch_depth', value);
    return null;
  }
  if (!isPlainObject(value)) {
    markInvalidPayload(context, 'op_not_object', value);
    return null;
  }
  const type = typeof value.type === 'string' ? value.type : '';
  if (!type) {
    markInvalidPayload(context, 'op_missing_type', value);
    return null;
  }

  if (type === 'upsertElement') {
    const element = coerceBoardElement(value.element, context);
    if (!element) {
      return null;
    }
    return { type: 'upsertElement', element };
  }
  if (type === 'appendStrokePoints') {
    const id = toId(value.id);
    if (!id || !Array.isArray(value.points)) {
      markInvalidPayload(context, 'invalid_append_points', value);
      return null;
    }
    const points = toBoardPoints(value.points, MAX_POINTS_PER_APPEND, context);
    if (points.length === 0) {
      markInvalidPayload(context, 'invalid_append_points', value);
      return null;
    }
    return { type: 'appendStrokePoints', id, points };
  }
  if (type === 'deleteElement') {
    const id = toId(value.id);
    if (!id) {
      markInvalidPayload(context, 'invalid_delete', value);
      return null;
    }
    return { type: 'deleteElement', id };
  }
  if (type === 'offsetElement') {
    const id = toId(value.id);
    const dx = toFiniteNumber(value.dx);
    const dy = toFiniteNumber(value.dy);
    if (!id || dx === null || dy === null) {
      markInvalidPayload(context, 'invalid_offset', value);
      return null;
    }
    return { type: 'offsetElement', id, dx, dy };
  }
  if (type === 'setElementGeometry') {
    const id = toId(value.id);
    if (!id) {
      markInvalidPayload(context, 'invalid_geometry_id', value);
      return null;
    }
    const op: Extract<BoardOp, { type: 'setElementGeometry' }> = { type: 'setElementGeometry', id };
    const hasOwn = Object.prototype.hasOwnProperty;
    const x = toFiniteNumber(value.x);
    const y = toFiniteNumber(value.y);
    const w = toFiniteNumber(value.w);
    const h = toFiniteNumber(value.h);
    const pointsArray = hasOwn.call(value, 'points') ? value.points : undefined;
    if (x !== null) {
      op.x = x;
    } else if (hasOwn.call(value, 'x')) {
      markInvalidPayload(context, 'invalid_geometry_value', value);
      return null;
    }
    if (y !== null) {
      op.y = y;
    } else if (hasOwn.call(value, 'y')) {
      markInvalidPayload(context, 'invalid_geometry_value', value);
      return null;
    }
    if (w !== null) {
      op.w = w;
    } else if (hasOwn.call(value, 'w')) {
      markInvalidPayload(context, 'invalid_geometry_value', value);
      return null;
    }
    if (h !== null) {
      op.h = h;
    } else if (hasOwn.call(value, 'h')) {
      markInvalidPayload(context, 'invalid_geometry_value', value);
      return null;
    }
    if (pointsArray !== undefined) {
      if (!Array.isArray(pointsArray)) {
        markInvalidPayload(context, 'invalid_geometry_points', value);
        return null;
      }
      const points = toBoardPoints(pointsArray, MAX_POINTS_PER_ELEMENT, context);
      if (points.length === 0) {
        markInvalidPayload(context, 'invalid_geometry_points', value);
        return null;
      }
      op.points = points;
    }
    if (op.x === undefined && op.y === undefined && op.w === undefined && op.h === undefined && !op.points) {
      markInvalidPayload(context, 'empty_geometry_patch', value);
      return null;
    }
    return op;
  }
  if (type === 'setElementStyle') {
    const id = toId(value.id);
    if (!id) {
      markInvalidPayload(context, 'invalid_style_id', value);
      return null;
    }
    const style = coerceStylePatch(value.style, context, 'invalid_style_patch', value);
    if (!style) {
      return null;
    }
    return { type: 'setElementStyle', id, style };
  }
  if (type === 'setElementText') {
    const id = toId(value.id);
    if (!id) {
      markInvalidPayload(context, 'invalid_text_id', value);
      return null;
    }
    const hasText =
      Object.prototype.hasOwnProperty.call(value, 'text') ||
      Object.prototype.hasOwnProperty.call(value, 'label') ||
      Object.prototype.hasOwnProperty.call(value, 'content');
    if (!hasText) {
      markInvalidPayload(context, 'missing_text_payload', value);
      return null;
    }
    const text = toTextValue(value.text ?? value.label ?? value.content, context);
    if (text === null) {
      markInvalidPayload(context, 'invalid_text_payload', value);
      return null;
    }
    return { type: 'setElementText', id, text };
  }
  if (type === 'duplicateElement') {
    const id = toId(value.id);
    const newId = toId(value.newId);
    if (!id || !newId) {
      markInvalidPayload(context, 'invalid_duplicate_ids', value);
      return null;
    }
    const op: Extract<BoardOp, { type: 'duplicateElement' }> = { type: 'duplicateElement', id, newId };
    const hasOwn = Object.prototype.hasOwnProperty;
    const dx = toFiniteNumber(value.dx);
    if (dx !== null) {
      op.dx = dx;
    } else if (hasOwn.call(value, 'dx')) {
      markInvalidPayload(context, 'invalid_duplicate_offset', value);
      return null;
    }
    const dy = toFiniteNumber(value.dy);
    if (dy !== null) {
      op.dy = dy;
    } else if (hasOwn.call(value, 'dy')) {
      markInvalidPayload(context, 'invalid_duplicate_offset', value);
      return null;
    }
    return op;
  }
  if (type === 'setElementZIndex') {
    const id = toId(value.id);
    const zIndex = toFiniteNumber(value.zIndex);
    if (!id || zIndex === null) {
      markInvalidPayload(context, 'invalid_zindex', value);
      return null;
    }
    return { type: 'setElementZIndex', id, zIndex };
  }
  if (type === 'alignElements') {
    if (!Array.isArray(value.ids)) {
      markInvalidPayload(context, 'invalid_align_ids', value);
      return null;
    }
    const ids = toStringArray(value.ids, 1200);
    const axis = typeof value.axis === 'string' ? (value.axis as AlignAxis) : null;
    if (ids.length === 0 || !axis || !ALIGN_AXIS_SET.has(axis)) {
      markInvalidPayload(context, 'invalid_align_payload', value);
      return null;
    }
    return { type: 'alignElements', ids, axis };
  }
  if (type === 'distributeElements') {
    if (!Array.isArray(value.ids)) {
      markInvalidPayload(context, 'invalid_distribute_ids', value);
      return null;
    }
    const ids = toStringArray(value.ids, 1200);
    const axis = typeof value.axis === 'string' ? (value.axis as DistributeAxis) : null;
    if (ids.length === 0 || !axis || !DISTRIBUTE_AXIS_SET.has(axis)) {
      markInvalidPayload(context, 'invalid_distribute_payload', value);
      return null;
    }
    const op: Extract<BoardOp, { type: 'distributeElements' }> = { type: 'distributeElements', ids, axis };
    const gap = toFiniteNumber(value.gap);
    if (gap !== null) {
      op.gap = gap;
    } else if (Object.prototype.hasOwnProperty.call(value, 'gap')) {
      markInvalidPayload(context, 'invalid_distribute_gap', value);
      return null;
    }
    return op;
  }
  if (type === 'clearBoard') {
    return { type: 'clearBoard' };
  }
  if (type === 'setViewport') {
    const viewport = sanitizeViewportPatch(value.viewport);
    if (!viewport) {
      markInvalidPayload(context, 'invalid_viewport', value);
      return null;
    }
    return { type: 'setViewport', viewport };
  }
  if (type === 'batch') {
    if (!Array.isArray(value.ops) || value.ops.length === 0) {
      markInvalidPayload(context, 'invalid_batch', value);
      return null;
    }
    const nestedOps = sanitizeOpsArray(value.ops, context, depth + 1);
    if (context.invalid) {
      return null;
    }
    if (nestedOps.length === 0) {
      markInvalidPayload(context, 'invalid_batch', value);
      return null;
    }
    return { type: 'batch', ops: nestedOps };
  }

  markInvalidPayload(context, 'unknown_op_type', value);
  return null;
};

const sanitizeOpsArray = (value: unknown, context: SanitizeContext, depth: number): BoardOp[] => {
  if (context.invalid) {
    return [];
  }
  if (!Array.isArray(value)) {
    markInvalidPayload(context, 'ops_not_array', value);
    return [];
  }
  const safe: BoardOp[] = [];
  const limit = Math.min(value.length, MAX_BOARD_OPS_PER_ENVELOPE);
  for (let index = 0; index < limit; index += 1) {
    if (context.invalid) {
      break;
    }
    const op = sanitizeBoardOp(value[index], context, depth);
    if (context.invalid) {
      break;
    }
    if (op) {
      safe.push(op);
    }
  }
  if (!context.invalid && value.length > limit) {
    context.truncatedOps += value.length - limit;
  }
  return context.invalid ? [] : safe;
};

const removeDuplicateOps = (ops: BoardOp[], context: DuplicateContext): BoardOp[] => {
  const filtered: BoardOp[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]!;
    if (op.type === 'upsertElement') {
      if (context.seenUpsertIds.has(op.element.id)) {
        context.duplicateIds.add(op.element.id);
        context.droppedFromDuplicates += 1;
        continue;
      }
      context.seenUpsertIds.add(op.element.id);
      filtered.push(op);
      continue;
    }
    if (op.type === 'duplicateElement') {
      if (
        context.seenNewIds.has(op.newId) ||
        context.knownIds.has(op.newId) ||
        context.seenUpsertIds.has(op.newId)
      ) {
        context.duplicateIds.add(op.newId);
        context.droppedFromDuplicates += 1;
        continue;
      }
      context.seenNewIds.add(op.newId);
      filtered.push(op);
      continue;
    }
    if (op.type === 'batch') {
      const nested = removeDuplicateOps(op.ops, context);
      if (nested.length === 0) {
        context.droppedFromDuplicates += 1;
        continue;
      }
      filtered.push({ type: 'batch', ops: nested });
      continue;
    }
    filtered.push(op);
  }
  return filtered;
};

const parseOpsEnvelope = (
  value: unknown,
): { ok: true; ops: unknown[] } | { ok: false; reason: BoardOpsGuardFailureReason } => {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'invalid_envelope' };
  }
  if (value.kind !== 'board_ops') {
    return { ok: false, reason: 'invalid_envelope' };
  }
  if (
    typeof value.schemaVersion !== 'number' ||
    !Number.isFinite(value.schemaVersion) ||
    value.schemaVersion !== BOARD_OPS_SCHEMA_VERSION
  ) {
    return { ok: false, reason: 'schema_mismatch' };
  }
  if (!Array.isArray(value.ops)) {
    return { ok: false, reason: 'missing_ops' };
  }
  if (value.ops.length === 0) {
    return { ok: false, reason: 'empty_ops' };
  }
  return { ok: true, ops: value.ops };
};

const buildKnownIdSet = (board: BoardState | null): Set<string> => {
  const known = new Set<string>();
  if (board?.elements) {
    Object.keys(board.elements).forEach((id) => {
      if (id) {
        known.add(id);
      }
    });
  }
  return known;
};

const cloneBoardState = (state: BoardState | null): BoardState | null => {
  if (!state) {
    return null;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as BoardState;
};

const defaultTelemetryEmitter = (event: AdapterGuardTelemetryEvent) => {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[SenseBoard][adapter_guard]', event);
  }
};

export const createIncrementalBoardOpsGuard = (options?: {
  emitTelemetry?: (event: AdapterGuardTelemetryEvent) => void;
}): IncrementalBoardOpsGuard => {
  let lastSnapshot: BoardState | null = null;
  const counters: BoardOpsGuardCounters = {
    schemaRejections: 0,
    payloadRejections: 0,
    payloadRepairs: 0,
    duplicateRepairs: 0,
  };
  const emitTelemetry = options?.emitTelemetry ?? defaultTelemetryEmitter;
  const snapshotCounters = (): BoardOpsGuardCounters => ({
    schemaRejections: counters.schemaRejections,
    payloadRejections: counters.payloadRejections,
    payloadRepairs: counters.payloadRepairs,
    duplicateRepairs: counters.duplicateRepairs,
  });

  const guardIncomingOps = (raw: unknown, context?: BoardOpsGuardContext): BoardOpsGuardResult => {
    if (context && Object.prototype.hasOwnProperty.call(context, 'boardBefore')) {
      lastSnapshot = cloneBoardState(context.boardBefore ?? null);
    }

    const parsed = parseOpsEnvelope(raw);
    if (!parsed.ok) {
      counters.schemaRejections += 1;
      emitTelemetry({
        category: 'canvas_surface_guard',
        guard: 'schema',
        action: 'reject',
        reason: parsed.reason,
        provider: context?.provider,
        source: context?.source,
        counters: snapshotCounters(),
      });
      return {
        ok: false,
        acceptedOps: [],
        reason: parsed.reason,
        droppedInvalidCount: 0,
        droppedDuplicateCount: 0,
        truncatedCount: 0,
        duplicateIds: [],
      };
    }

    const sanitizeContext: SanitizeContext = {
      truncatedOps: 0,
      truncatedPoints: 0,
      textTruncations: 0,
      invalidCount: 0,
    };
    const sanitized = sanitizeOpsArray(parsed.ops, sanitizeContext, 0);
    if (sanitizeContext.invalid) {
      counters.payloadRejections += 1;
      emitTelemetry({
        category: 'canvas_surface_guard',
        guard: 'payload',
        action: 'reject',
        reason: sanitizeContext.invalid.reason,
        provider: context?.provider,
        source: context?.source,
        sample: { detail: sanitizeContext.invalid.detail, payload: sanitizeContext.invalid.sample },
        counters: snapshotCounters(),
      });
      return {
        ok: false,
        acceptedOps: [],
        reason: sanitizeContext.invalid.reason,
        droppedInvalidCount: sanitizeContext.invalidCount,
        droppedDuplicateCount: 0,
        truncatedCount: sanitizeContext.truncatedOps + sanitizeContext.truncatedPoints + sanitizeContext.textTruncations,
        duplicateIds: [],
      };
    }

    const duplicateContext: DuplicateContext = {
      knownIds: buildKnownIdSet(lastSnapshot),
      seenUpsertIds: new Set(),
      seenNewIds: new Set(),
      duplicateIds: new Set(),
      droppedFromDuplicates: 0,
    };
    const deduped = removeDuplicateOps(sanitized, duplicateContext);

    const truncatedTotal =
      sanitizeContext.truncatedOps + sanitizeContext.truncatedPoints + sanitizeContext.textTruncations;
    if (truncatedTotal > 0) {
      counters.payloadRepairs += truncatedTotal;
      if (sanitizeContext.truncatedOps > 0) {
        emitTelemetry({
          category: 'canvas_surface_guard',
          guard: 'payload',
          action: 'repair',
          reason: 'ops_truncated',
          provider: context?.provider,
          source: context?.source,
          droppedOps: sanitizeContext.truncatedOps,
          counters: snapshotCounters(),
        });
      }
      if (sanitizeContext.truncatedPoints > 0) {
        emitTelemetry({
          category: 'canvas_surface_guard',
          guard: 'payload',
          action: 'repair',
          reason: 'points_truncated',
          provider: context?.provider,
          source: context?.source,
          droppedOps: sanitizeContext.truncatedPoints,
          counters: snapshotCounters(),
        });
      }
      if (sanitizeContext.textTruncations > 0) {
        emitTelemetry({
          category: 'canvas_surface_guard',
          guard: 'payload',
          action: 'repair',
          reason: 'text_truncated',
          provider: context?.provider,
          source: context?.source,
          droppedOps: sanitizeContext.textTruncations,
          counters: snapshotCounters(),
        });
      }
    }

    if (duplicateContext.duplicateIds.size > 0) {
      counters.duplicateRepairs += duplicateContext.droppedFromDuplicates;
      emitTelemetry({
        category: 'canvas_surface_guard',
        guard: 'duplicate_id',
        action: 'repair',
        reason: 'duplicate_element_ids',
        provider: context?.provider,
        source: context?.source,
        duplicateIds: Array.from(duplicateContext.duplicateIds).slice(0, MAX_DUPLICATE_IDS_REPORTED),
        droppedOps: duplicateContext.droppedFromDuplicates,
        counters: snapshotCounters(),
      });
    }

    if (deduped.length === 0) {
      counters.payloadRejections += 1;
      emitTelemetry({
        category: 'canvas_surface_guard',
        guard: 'payload',
        action: 'reject',
        reason: 'empty_ops',
        provider: context?.provider,
        source: context?.source,
        counters: snapshotCounters(),
      });
      return {
        ok: false,
        acceptedOps: [],
        reason: 'empty_ops',
        droppedInvalidCount: 0,
        droppedDuplicateCount: duplicateContext.droppedFromDuplicates,
        truncatedCount: truncatedTotal,
        duplicateIds: Array.from(duplicateContext.duplicateIds).slice(0, MAX_DUPLICATE_IDS_REPORTED),
      };
    }

    return {
      ok: true,
      acceptedOps: deduped,
      droppedInvalidCount: 0,
      droppedDuplicateCount: duplicateContext.droppedFromDuplicates,
      truncatedCount: truncatedTotal,
      duplicateIds: Array.from(duplicateContext.duplicateIds).slice(0, MAX_DUPLICATE_IDS_REPORTED),
    };
  };

  const snapshot = (board: BoardState | null) => {
    lastSnapshot = cloneBoardState(board);
  };

  const recoverLastAcceptedBoard = (): BoardState | null => {
    return cloneBoardState(lastSnapshot);
  };

  return {
    get lastAcceptedBoard() {
      return lastSnapshot;
    },
    counters,
    snapshot,
    recoverLastAcceptedBoard,
    guardIncomingOps,
  };
};
