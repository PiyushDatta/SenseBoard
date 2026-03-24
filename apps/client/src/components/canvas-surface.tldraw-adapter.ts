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

interface DraftConversionDiagnostics {
  hiddenElementIds: Set<string>;
  invalidElementIds: Set<string>;
}

export interface TranscriptWindowContext {
  id: string;
  summary?: string;
  lines?: string[];
}

export type BoardDeltaFallbackReason = 'zero_delta' | 'invalid_ops' | null;

export interface BoardDeltaTelemetryEvent {
  timestamp: number;
  revision: number;
  lastUpdatedAt: number;
  windowId: string;
  boardElementCount: number;
  draftCount: number;
  zeroDelta: boolean;
  zeroOpStrikes: number;
  orderChanged: boolean;
  fallbackTriggered: boolean;
  fallbackReason: BoardDeltaFallbackReason;
  addedIds: string[];
  removedIds: string[];
  changedIds: string[];
  hiddenElementIds: string[];
  invalidElementIds: string[];
  transcriptSummary?: string;
}

export type BoardDeltaTelemetryListener = (event: BoardDeltaTelemetryEvent) => void;

interface BoardSummary {
  fingerprint: string;
  revision: number;
  lastUpdatedAt: number;
  elementHashes: Record<string, string>;
  elementCount: number;
  orderSignature: string;
}

interface BoardDeltaSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

const ZERO_OP_STRIKE_LIMIT = 2;
const TELEMETRY_HISTORY_LIMIT = 12;

let transcriptWindowContext: TranscriptWindowContext | null = null;
const boardSummaryByWindowId = new Map<string, BoardSummary>();
let lastWindowContextId: string | null = null;
const zeroOpStrikesByWindow = new Map<string, number>();
let boardDeltaTelemetryListener: BoardDeltaTelemetryListener | null = null;
const boardDeltaTelemetryHistory: BoardDeltaTelemetryEvent[] = [];

const createDraftConversionDiagnostics = (): DraftConversionDiagnostics => ({
  hiddenElementIds: new Set<string>(),
  invalidElementIds: new Set<string>(),
});

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(36);
};

const serializeStyle = (style: BoardElement['style'] | undefined): string => {
  if (!style) {
    return '';
  }
  return Object.entries(style)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}:${String(value ?? '')}`)
    .join(',');
};

const hashBoardElement = (element: BoardElement): string => {
  const parts: string[] = [
    element.id,
    element.kind,
    String(element.zIndex ?? 0),
    element.createdBy,
    serializeStyle(element.style),
  ];

  if ('x' in element) {
    parts.push(`x:${(element as { x: number }).x}`, `y:${(element as { y: number }).y}`);
  }
  if ('w' in element) {
    parts.push(`w:${(element as { w: number }).w}`, `h:${(element as { h: number }).h}`);
  }
  if ('text' in element && typeof (element as { text?: string }).text === 'string') {
    parts.push(`text:${(element as { text: string }).text}`);
  }
  if ('title' in element && typeof (element as { title?: string }).title === 'string') {
    parts.push(`title:${(element as { title: string }).title}`);
  }
  if ('points' in element) {
    const points = (element as { points: BoardPoint[] }).points
      .map((point) => `${point[0]}:${point[1]}`)
      .join('|');
    parts.push(`points:${points}`);
  }

  return hashString(parts.join('|'));
};

const summarizeBoardState = (board: BoardState): BoardSummary => {
  const ids = Object.keys(board.elements).sort();
  const elementHashes: Record<string, string> = {};
  const fingerprintSeed: string[] = [board.order.join('|')];
  ids.forEach((id) => {
    const element = board.elements[id];
    if (!element) {
      return;
    }
    const hash = hashBoardElement(element);
    elementHashes[id] = hash;
    fingerprintSeed.push(`${id}:${hash}`);
  });

  const orderSignature = hashString(board.order.join('|'));
  return {
    fingerprint: hashString(fingerprintSeed.join(';')),
    revision: board.revision,
    lastUpdatedAt: board.lastUpdatedAt,
    elementHashes,
    elementCount: ids.length,
    orderSignature,
  };
};

const diffBoardSummaries = (current: BoardSummary, previous: BoardSummary | null): BoardDeltaSummary => {
  if (!previous) {
    return {
      added: Object.keys(current.elementHashes),
      removed: [],
      changed: [],
    };
  }

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  Object.keys(current.elementHashes).forEach((id) => {
    if (!previous.elementHashes[id]) {
      added.push(id);
    } else if (current.elementHashes[id] !== previous.elementHashes[id]) {
      changed.push(id);
    }
  });

  Object.keys(previous.elementHashes).forEach((id) => {
    if (!current.elementHashes[id]) {
      removed.push(id);
    }
  });

  return { added, removed, changed };
};

const getWindowId = (): string => {
  const id = transcriptWindowContext?.id?.trim();
  return id && id.length > 0 ? id : 'global';
};

const updateZeroOpStrikeCount = (windowId: string, zeroDelta: boolean): number => {
  if (!zeroDelta) {
    zeroOpStrikesByWindow.set(windowId, 0);
    return 0;
  }
  const next = (zeroOpStrikesByWindow.get(windowId) ?? 0) + 1;
  zeroOpStrikesByWindow.set(windowId, next);
  return next;
};

const recordBoardDeltaTelemetry = (event: BoardDeltaTelemetryEvent) => {
  boardDeltaTelemetryHistory.push(event);
  while (boardDeltaTelemetryHistory.length > TELEMETRY_HISTORY_LIMIT) {
    boardDeltaTelemetryHistory.shift();
  }
  if (boardDeltaTelemetryListener) {
    boardDeltaTelemetryListener(event);
  }
};

const truncateFallbackLine = (value: string, maxLength = 120): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const buildDeterministicSketchFallback = (
  board: BoardState,
  diagnostics: DraftConversionDiagnostics,
  reason: BoardDeltaFallbackReason,
  zeroOpStrikes: number,
): TldrawDraftShape[] => {
  const windowId = getWindowId();
  const transcriptLines = (transcriptWindowContext?.lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4)
    .map((line) => `• ${truncateFallbackLine(line, 150)}`);
  const summaryLine = transcriptWindowContext?.summary?.trim() || 'Live transcript sketch fallback';
  const invalidIds = Array.from(diagnostics.invalidElementIds).slice(0, 3);
  const reasonLine =
    reason === 'invalid_ops'
      ? `Reason: invalid ops${invalidIds.length > 0 ? ` (${invalidIds.join(', ')})` : ''}`
      : 'Reason: repeated empty board deltas';
  const strikesLine = `Revision ${board.revision} • strikes ${zeroOpStrikes}`;
  const lines = [summaryLine, reasonLine, strikesLine, ...transcriptLines].map((line) => truncateFallbackLine(line, 160));
  const text = lines.join('\n');

  const seed = hashString(`${windowId}:${board.revision}:${board.lastUpdatedAt}`);
  const seedValue = Number.parseInt(seed, 36) || 0;
  const width = 760;
  const height = 260 + Math.max(0, transcriptLines.length - 2) * 24;
  const x = 140 + (seedValue % 120);
  const y = 180 + (Math.floor(seedValue / 7) % 90);
  const zIndex = 100000 + (seedValue % 1000);

  return [
    {
      kind: 'geo',
      id: toSafeShapeKey(`fallback:frame:${windowId}:${seed}`),
      x,
      y,
      zIndex,
      props: {
        geo: 'rectangle',
        w: width,
        h: height,
        color: 'light-violet',
        labelColor: 'light-violet',
        fill: 'semi',
        size: 'm',
        dash: 'draw',
        text: '',
        align: 'middle',
        verticalAlign: 'middle',
      },
    },
    {
      kind: 'text',
      id: toSafeShapeKey(`fallback:text:${windowId}:${seed}`),
      x: x + 24,
      y: y + 24,
      zIndex: zIndex + 1,
      props: {
        text,
        color: 'black',
        size: 'm',
        w: width - 48,
        autoSize: false,
      },
    },
  ];
};

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
  diagnostics?: DraftConversionDiagnostics,
): TldrawDraftShape | null => {
  const strokeColor = element.style?.strokeColor;
  const fillColor = element.style?.fillColor;
  const strokeWidth = element.style?.strokeWidth;
  const roughness = element.style?.roughness;
  const fontSize = element.style?.fontSize;
  const zIndex = element.zIndex ?? orderIndex;
  const safeId = toSafeShapeKey(element.id);
  const markHidden = () => diagnostics?.hiddenElementIds.add(element.id);
  const markInvalid = () => diagnostics?.invalidElementIds.add(element.id);

  if (element.kind === 'text') {
    if (shouldHideAiText(element.id, showAiNotes)) {
      markHidden();
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
      markInvalid();
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
      markInvalid();
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

  markInvalid();
  return null;
};

export const boardToTldrawDraftShapes = (
  board: BoardState | null | undefined,
  showAiNotes: boolean,
): TldrawDraftShape[] => {
  const windowId = getWindowId();
  if (!board) {
    boardSummaryByWindowId.delete(windowId);
    zeroOpStrikesByWindow.delete(windowId);
    return [];
  }

  const diagnostics = createDraftConversionDiagnostics();
  const ordered = getOrderedElements(board);
  const textContainers = ordered
    .map((element) => toContainerBounds(element))
    .filter((value): value is TextContainerBounds => value !== null)
    .sort((left, right) => left.w * left.h - right.w * right.h);
  const drafts = ordered
    .map((element, orderIndex) => toDraftShape(element, orderIndex, showAiNotes, textContainers, diagnostics))
    .filter((shape): shape is TldrawDraftShape => Boolean(shape));

  drafts.sort((left, right) => left.zIndex - right.zIndex);

  const summary = summarizeBoardState(board);
  const previousSummary = boardSummaryByWindowId.get(windowId) ?? null;
  const delta = diffBoardSummaries(summary, previousSummary);
  const orderChanged = Boolean(previousSummary) && summary.orderSignature !== previousSummary.orderSignature;
  const structureUnchanged = delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0 && !orderChanged;
  const lastUpdateChangedAt = previousSummary?.lastUpdatedAt ?? 0;
  const hasTranscriptContext = Boolean(transcriptWindowContext);
  const transcriptWindowChanged = hasTranscriptContext && lastWindowContextId !== null && windowId !== lastWindowContextId;
  const zeroDelta =
    hasTranscriptContext &&
    Boolean(previousSummary) &&
    structureUnchanged &&
    (summary.lastUpdatedAt !== lastUpdateChangedAt || transcriptWindowChanged);
  const zeroOpStrikes = updateZeroOpStrikeCount(windowId, zeroDelta);
  const invalidOpsDetected = diagnostics.invalidElementIds.size > 0;

  let fallbackReason: BoardDeltaFallbackReason = null;
  if (drafts.length === 0 && invalidOpsDetected) {
    fallbackReason = 'invalid_ops';
  } else if (drafts.length === 0 && zeroDelta && zeroOpStrikes >= ZERO_OP_STRIKE_LIMIT) {
    fallbackReason = 'zero_delta';
  }

  let resolvedDrafts = drafts;
  if (fallbackReason) {
    resolvedDrafts = buildDeterministicSketchFallback(board, diagnostics, fallbackReason, zeroOpStrikes);
    zeroOpStrikesByWindow.set(windowId, 0);
  }

  resolvedDrafts.sort((left, right) => left.zIndex - right.zIndex);

  // Emit structured telemetry so incremental board behavior can be asserted in tests.
  recordBoardDeltaTelemetry({
    timestamp: Date.now(),
    revision: board.revision,
    lastUpdatedAt: board.lastUpdatedAt,
    windowId,
    boardElementCount: summary.elementCount,
    draftCount: resolvedDrafts.length,
    zeroDelta,
    zeroOpStrikes,
    orderChanged,
    fallbackTriggered: Boolean(fallbackReason),
    fallbackReason,
    addedIds: delta.added,
    removedIds: delta.removed,
    changedIds: delta.changed,
    hiddenElementIds: Array.from(diagnostics.hiddenElementIds),
    invalidElementIds: Array.from(diagnostics.invalidElementIds),
    transcriptSummary: transcriptWindowContext?.summary,
  });

  boardSummaryByWindowId.set(windowId, summary);
  lastWindowContextId = hasTranscriptContext ? windowId : null;

  return resolvedDrafts;
};

export const setTranscriptWindowContext = (context: TranscriptWindowContext | null): void => {
  transcriptWindowContext = context;
};

export const registerBoardDeltaTelemetryListener = (listener: BoardDeltaTelemetryListener | null): void => {
  boardDeltaTelemetryListener = listener;
};

export const getBoardDeltaTelemetryHistory = (): BoardDeltaTelemetryEvent[] => {
  return [...boardDeltaTelemetryHistory];
};

/**
 * Clears all board delta tracking state. Tests should call this to ensure isolated sessions.
 */
export const resetBoardDeltaTelemetry = (): void => {
  boardDeltaTelemetryHistory.length = 0;
  zeroOpStrikesByWindow.clear();
  boardSummaryByWindowId.clear();
  transcriptWindowContext = null;
  lastWindowContextId = null;
  boardDeltaTelemetryListener = null;
};

export const getBoardDeltaZeroOpStrikes = (windowId?: string): number => {
  if (windowId) {
    return zeroOpStrikesByWindow.get(windowId) ?? 0;
  }
  return zeroOpStrikesByWindow.get(getWindowId()) ?? 0;
};
