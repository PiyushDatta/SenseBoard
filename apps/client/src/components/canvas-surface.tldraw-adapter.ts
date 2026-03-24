import type { BoardElement, BoardOp, BoardPoint, BoardState } from '../../../shared/types';

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

const BOARD_OP_GUARD_MAX_DELTA = 4096;
const BOARD_OP_GUARD_MAX_COORD = 200000;
const BOARD_OP_GUARD_MIN_ZOOM = 0.05;
const BOARD_OP_GUARD_MAX_ZOOM = 5;
const BOARD_OP_GUARD_PROVIDER_UNKNOWN = 'unknown';

type GuardElementAuthor = BoardElement['createdBy'] | 'user';

const BOARD_OP_GUARD_ALLOWED_AUTHORS = new Set<GuardElementAuthor>(['ai', 'system', 'user']);

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

const guardFallbackSequenceByScope = new Map<string, number>();
const BOARD_OP_GUARD_DEFAULT_SCOPE = 'default';

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

const sanitizeGuardScopeSegment = (value: string | undefined): string => {
  if (!value) {
    return 'default';
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'default';
};

const makeGuardFallbackScopeKey = (providerTag: string, fallbackSeed?: string): string => {
  const providerSegment = sanitizeGuardScopeSegment(providerTag || BOARD_OP_GUARD_PROVIDER_UNKNOWN);
  const seedSegment = sanitizeGuardScopeSegment(fallbackSeed);
  return `${providerSegment}:${seedSegment}`;
};

const getNextGuardFallbackSequence = (scopeKey: string): number => {
  const next = (guardFallbackSequenceByScope.get(scopeKey) ?? 0) + 1;
  guardFallbackSequenceByScope.set(scopeKey, next);
  return next;
};

const toGuardScopeKey = (scope?: string): string => {
  return sanitizeGuardScopeSegment(scope ?? BOARD_OP_GUARD_DEFAULT_SCOPE);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

type GuardStylePatch = NonNullable<BoardElement['style']>;
type GuardReasonRecord = Record<string, number>;

interface BoardOpGuardContext {
  maxDelta: number;
  clampReasons: GuardReasonRecord;
  dropReasons: GuardReasonRecord;
  droppedOps: number;
  clampedOps: number;
}

const recordGuardDrop = (ctx: BoardOpGuardContext, reason: string) => {
  ctx.droppedOps += 1;
  ctx.dropReasons[reason] = (ctx.dropReasons[reason] ?? 0) + 1;
};

const recordGuardClamp = (ctx: BoardOpGuardContext, reason: string) => {
  ctx.clampReasons[reason] = (ctx.clampReasons[reason] ?? 0) + 1;
};

const clampGuardDelta = (value: number, reason: string, ctx: BoardOpGuardContext): { value: number; clamped: boolean } => {
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

const sanitizeGuardStylePatch = (style: Partial<GuardStylePatch> | undefined): Partial<GuardStylePatch> | null => {
  if (!style || typeof style !== 'object') {
    return null;
  }

  const sanitized: Partial<GuardStylePatch> = {};
  if (typeof style.strokeColor === 'string' && style.strokeColor.trim().length > 0) {
    sanitized.strokeColor = style.strokeColor.trim();
  }
  if (typeof style.fillColor === 'string' && style.fillColor.trim().length > 0) {
    sanitized.fillColor = style.fillColor.trim();
  }
  if (typeof style.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)) {
    sanitized.strokeWidth = style.strokeWidth;
  }
  if (typeof style.roughness === 'number' && Number.isFinite(style.roughness)) {
    sanitized.roughness = style.roughness;
  }
  if (typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)) {
    sanitized.fontSize = style.fontSize;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
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
  if (!sanitizeGuardAuthor((element as { createdBy?: unknown }).createdBy)) {
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

  const sanitizePointsForElement = (points: BoardPoint[] | undefined, reason: string, minLength: number): BoardPoint[] | null => {
    const result = sanitizeGuardPoints(points, ctx, reason);
    if (result.points.length < minLength) {
      recordGuardDrop(ctx, 'invalid_element_points');
      return null;
    }
    elementClamped ||= result.clamped;
    return result.points;
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
      if (sanitizedElement.kind === 'sticky' && typeof sanitizedElement.text !== 'string') {
        recordGuardDrop(ctx, 'invalid_element_text');
        return null;
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
      break;
    }
    case 'stroke': {
      const points = sanitizePointsForElement(sanitizedElement.points, 'stroke_points', 1);
      if (!points) {
        return null;
      }
      cloneElementIfNeeded();
      sanitizedElement.points = points;
      break;
    }
    case 'line': {
      const points = sanitizePointsForElement(sanitizedElement.points, 'line_points', 2);
      if (!points) {
        return null;
      }
      cloneElementIfNeeded();
      sanitizedElement.points = points;
      break;
    }
    case 'arrow': {
      const points = sanitizePointsForElement(sanitizedElement.points, 'arrow_points', 2);
      if (!points) {
        return null;
      }
      cloneElementIfNeeded();
      sanitizedElement.points = points;
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

const sanitizeBoardOp = (op: BoardOp | null | undefined, ctx: BoardOpGuardContext): BoardOp | null => {
  if (!op) {
    recordGuardDrop(ctx, 'null_op');
    return null;
  }

  switch (op.type) {
    case 'batch': {
      const nested = sanitizeBoardOps(op.ops, ctx);
      if (nested.length === 0) {
        recordGuardDrop(ctx, 'empty_batch');
        return null;
      }
      return { type: 'batch', ops: nested };
    }
    case 'appendStrokePoints': {
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
    }
    case 'offsetElement': {
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
    }
    case 'duplicateElement': {
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
    }
    case 'setElementGeometry': {
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
    }
    case 'setElementStyle': {
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
      return { ...op, id, style };
    }
    case 'setElementText': {
      const id = sanitizeGuardElementId(op.id);
      if (!id) {
        recordGuardDrop(ctx, 'invalid_text_id');
        return null;
      }
      if (typeof op.text !== 'string') {
        recordGuardDrop(ctx, 'invalid_text');
        return null;
      }
      return { ...op, id, text: op.text };
    }
    case 'setElementZIndex': {
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
    }
    case 'alignElements': {
      const ids = Array.from(
        new Set((op.ids ?? []).filter((idValue): idValue is string => typeof idValue === 'string' && idValue.trim().length > 0)),
      );
      if (ids.length === 0) {
        recordGuardDrop(ctx, 'empty_align_ids');
        return null;
      }
      return { ...op, ids };
    }
    case 'distributeElements': {
      const ids = Array.from(
        new Set((op.ids ?? []).filter((idValue): idValue is string => typeof idValue === 'string' && idValue.trim().length > 0)),
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
    }
    case 'setViewport': {
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
    }
    case 'deleteElement': {
      const id = sanitizeGuardElementId(op.id);
      if (!id) {
        recordGuardDrop(ctx, 'invalid_delete_id');
        return null;
      }
      return { ...op, id };
    }
    case 'clearBoard':
      return op;
    case 'upsertElement':
      return sanitizeUpsertElement(op, ctx);
    default:
      recordGuardDrop(ctx, 'unknown_op');
      return null;
  }
};

const sanitizeBoardOps = (ops: BoardOp[] | undefined, ctx: BoardOpGuardContext): BoardOp[] => {
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

export interface BoardOpGuardTelemetryEvent {
  kind: 'board_op_guard';
  scopeKey: string;
  providerTag: string;
  totalOps: number;
  sanitizedOps: number;
  droppedOps: number;
  clampedOps: number;
  fallbackOps: number;
  clampReasons: GuardReasonRecord;
  dropReasons: GuardReasonRecord;
  timestamp: number;
}

type BoardOpGuardTelemetryHandler = (event: BoardOpGuardTelemetryEvent) => void;

const boardOpGuardTelemetryHandlers = new Map<string, BoardOpGuardTelemetryHandler>();

export const setBoardOpGuardTelemetryHandler = (handler: BoardOpGuardTelemetryHandler | null, scope?: string) => {
  const scopeKey = toGuardScopeKey(scope);
  if (handler) {
    boardOpGuardTelemetryHandlers.set(scopeKey, handler);
    return;
  }
  boardOpGuardTelemetryHandlers.delete(scopeKey);
};

const emitBoardOpGuardTelemetry = (scopeKey: string, event: BoardOpGuardTelemetryEvent) => {
  const handler = boardOpGuardTelemetryHandlers.get(scopeKey);
  if (handler) {
    try {
      handler(event);
      return;
    } catch {
      // Swallow handler errors to keep guard execution safe.
    }
  }
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[board-op-guard:${scopeKey}]`, event);
  }
};

export interface BoardOpGuardHostNotice {
  kind: 'board_op_guard';
  scopeKey: string;
  severity: 'info' | 'warning';
  providerTag: string;
  message: string;
  droppedOps: number;
  clampedOps: number;
  fallbackOps: number;
}

type BoardOpGuardHostNoticeHandler = (notice: BoardOpGuardHostNotice) => void;

const boardOpGuardHostNoticeHandlers = new Map<string, BoardOpGuardHostNoticeHandler>();

export const setBoardOpGuardHostNoticeHandler = (handler: BoardOpGuardHostNoticeHandler | null, scope?: string) => {
  const scopeKey = toGuardScopeKey(scope);
  if (handler) {
    boardOpGuardHostNoticeHandlers.set(scopeKey, handler);
    return;
  }
  boardOpGuardHostNoticeHandlers.delete(scopeKey);
};

const notifyBoardOpGuardHost = (scopeKey: string, notice: BoardOpGuardHostNotice) => {
  const handler = boardOpGuardHostNoticeHandlers.get(scopeKey);
  if (handler) {
    try {
      handler(notice);
      return;
    } catch {
      // Ignore host notice handler errors.
    }
  }
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info(`[board-op-guard:notice:${scopeKey}]`, notice);
  }
};

export const resetBoardOpGuardScope = (scope?: string, providerTag?: string, fallbackSeed?: string) => {
  if (!scope) {
    boardOpGuardTelemetryHandlers.clear();
    boardOpGuardHostNoticeHandlers.clear();
    guardFallbackSequenceByScope.clear();
    return;
  }
  const scopeKey = toGuardScopeKey(scope);
  boardOpGuardTelemetryHandlers.delete(scopeKey);
  boardOpGuardHostNoticeHandlers.delete(scopeKey);

  const fallbackKey = makeGuardFallbackScopeKey(
    providerTag || BOARD_OP_GUARD_PROVIDER_UNKNOWN,
    fallbackSeed ?? scopeKey,
  );
  guardFallbackSequenceByScope.delete(fallbackKey);
};

const deterministicGuardHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

interface GuardFallbackInput {
  providerTag: string;
  droppedOps: number;
  clampedOps: number;
  sanitizedCount: number;
  scopeKey: string;
  sequence: number;
  seed?: string;
}

const buildGuardFallbackOps = (input: GuardFallbackInput): BoardOp[] => {
  const seedSource =
    input.seed ??
    `${input.scopeKey}:${input.sequence}:${input.providerTag}:${input.droppedOps}:${input.clampedOps}:${input.sanitizedCount}`;
  const hash = deterministicGuardHash(seedSource);
  const suffix = `${input.scopeKey}:${input.sequence.toString(36)}:${hash.toString(36)}`;
  const baseX = 200 + (hash % 220);
  const baseY = 160 + ((hash >> 5) % 160);
  const createdAt = 1700000000000 + (hash % 5000);
  const textColor = '#1f2937';
  const connectorColor = '#475569';

  const summary: BoardElement = {
    id: `guard:fallback:text:${suffix}:summary`,
    kind: 'text',
    x: baseX,
    y: baseY,
    text: `Board guard repaired ${input.droppedOps} drop(s)${input.clampedOps > 0 ? ` + ${input.clampedOps} clamp(s)` : ''}.`,
    createdAt,
    createdBy: 'system',
    style: {
      fontSize: 26,
      strokeColor: textColor,
    },
  };

  const provider: BoardElement = {
    id: `guard:fallback:text:${suffix}:provider`,
    kind: 'text',
    x: baseX,
    y: baseY + 90,
    text: `Provider: ${input.providerTag || BOARD_OP_GUARD_PROVIDER_UNKNOWN}`,
    createdAt,
    createdBy: 'system',
    style: {
      fontSize: 22,
      strokeColor: textColor,
    },
  };

  const connectorOne: BoardElement = {
    id: `guard:fallback:arrow:${suffix}:0`,
    kind: 'arrow',
    points: [
      [baseX - 140, baseY - 40],
      [baseX - 12, baseY + 18],
      [baseX + 60, baseY + 120],
    ],
    createdAt,
    createdBy: 'system',
    style: {
      strokeColor: connectorColor,
      strokeWidth: 2,
      roughness: 1.3,
    },
  };

  const connectorTwo: BoardElement = {
    id: `guard:fallback:arrow:${suffix}:1`,
    kind: 'arrow',
    points: [
      [baseX + 220, baseY + 10],
      [baseX + 80, baseY + 60],
      [baseX + 12, baseY + 150],
    ],
    createdAt,
    createdBy: 'system',
    style: {
      strokeColor: connectorColor,
      strokeWidth: 2,
      roughness: 1.3,
    },
  };

  return [summary, provider, connectorOne, connectorTwo].map((element): BoardOp => {
    return {
      type: 'upsertElement',
      element,
    };
  });
};

export interface BoardOpGuardOptions {
  providerTag?: string;
  maxDeltaMagnitude?: number;
  fallbackSeed?: string;
  runtimeScope?: string;
}

export interface BoardOpGuardResult {
  ops: BoardOp[];
  sanitizedOps: BoardOp[];
  fallbackOps: BoardOp[];
  totalOps: number;
  droppedOps: number;
  clampedOps: number;
  clampReasons: GuardReasonRecord;
  dropReasons: GuardReasonRecord;
  providerTag: string;
  scopeKey: string;
  intervened: boolean;
}

export const guardBoardOpsForTldraw = (
  ops: BoardOp[] | null | undefined,
  options?: BoardOpGuardOptions,
): BoardOpGuardResult => {
  const providerTag = options?.providerTag?.trim() || BOARD_OP_GUARD_PROVIDER_UNKNOWN;
  const maxDelta = Math.max(1, options?.maxDeltaMagnitude ?? BOARD_OP_GUARD_MAX_DELTA);
  const runtimeScopeKey = toGuardScopeKey(options?.runtimeScope);
  const ctx: BoardOpGuardContext = {
    maxDelta,
    clampReasons: {},
    dropReasons: {},
    droppedOps: 0,
    clampedOps: 0,
  };

  const sourceOps = Array.isArray(ops) ? ops : [];
  const sanitizedOps = sanitizeBoardOps(sourceOps, ctx);
  const intervened = ctx.droppedOps > 0 || ctx.clampedOps > 0;
  const fallbackScopeKey = makeGuardFallbackScopeKey(providerTag, options?.fallbackSeed ?? runtimeScopeKey);
  const fallbackSequence = intervened ? getNextGuardFallbackSequence(fallbackScopeKey) : 0;
  const fallbackOps =
    intervened && fallbackSequence > 0
      ? buildGuardFallbackOps({
          providerTag,
          droppedOps: ctx.droppedOps,
          clampedOps: ctx.clampedOps,
          sanitizedCount: sanitizedOps.length,
          scopeKey: fallbackScopeKey,
          sequence: fallbackSequence,
          seed: options?.fallbackSeed,
        })
      : [];
  const guardedOps = fallbackOps.length > 0 ? [...sanitizedOps, ...fallbackOps] : sanitizedOps;

  if (intervened) {
    emitBoardOpGuardTelemetry(runtimeScopeKey, {
      kind: 'board_op_guard',
      scopeKey: runtimeScopeKey,
      providerTag,
      totalOps: sourceOps.length,
      sanitizedOps: sanitizedOps.length,
      droppedOps: ctx.droppedOps,
      clampedOps: ctx.clampedOps,
      clampReasons: ctx.clampReasons,
      dropReasons: ctx.dropReasons,
      fallbackOps: fallbackOps.length,
      timestamp: Date.now(),
    });

    notifyBoardOpGuardHost(runtimeScopeKey, {
      kind: 'board_op_guard',
      scopeKey: runtimeScopeKey,
      severity: 'warning',
      providerTag,
      message: `Guard repaired ${ctx.droppedOps} dropped and ${ctx.clampedOps} clamped board ops.`,
      droppedOps: ctx.droppedOps,
      clampedOps: ctx.clampedOps,
      fallbackOps: fallbackOps.length,
    });
  }

  return {
    ops: guardedOps,
    sanitizedOps,
    fallbackOps,
    totalOps: sourceOps.length,
    droppedOps: ctx.droppedOps,
    clampedOps: ctx.clampedOps,
    clampReasons: ctx.clampReasons,
    dropReasons: ctx.dropReasons,
    providerTag,
    scopeKey: runtimeScopeKey,
    intervened,
  };
};
