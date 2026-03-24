import { useEffect, useState } from 'react';

import { BOARD_OPS_SCHEMA_VERSION } from '../../../shared/types';
import type { BoardElement, BoardOp, BoardOpsEnvelope, BoardPoint, BoardState } from '../../../shared/types';

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

const WATCHDOG_LATENCY_THRESHOLD_MS = 1800;
const WATCHDOG_LOG_PREFIX = '[tldraw-adapter-watchdog]';

export type AdapterFallbackReason = 'healthy' | 'latency' | 'empty_ops' | 'invalid_ops';

export interface AdapterWatchdogState {
  fallbackActive: boolean;
  fallbackReason: AdapterFallbackReason;
  lastAuthoritativeAt: number | null;
  queueLatencyMs: number;
}

export interface WatchdogQueueSample {
  queuedAt?: number;
  receivedAt?: number;
}

export interface AdapterWatchdogGuardResult {
  ops: BoardOp[];
  fallbackApplied: boolean;
  replayedFromTranscript: boolean;
  reason: AdapterFallbackReason;
}

export interface AdapterWatchdogOptions {
  maxQueueLatencyMs?: number;
  now?: () => number;
  logger?: (message: string, context?: Record<string, unknown>) => void;
  onFallbackChange?: (state: AdapterWatchdogState) => void;
}

export interface TldrawAdapterWatchdog {
  recordIncoming: (envelope: BoardOpsEnvelope | null | undefined, sample?: WatchdogQueueSample) => AdapterWatchdogGuardResult;
  clampOutgoingOps: (ops: BoardOp[] | null | undefined) => BoardOp[];
  getState: () => AdapterWatchdogState;
  subscribe: (listener: (state: AdapterWatchdogState) => void) => () => void;
  getLastReplayEnvelope: () => BoardOpsEnvelope | null;
  reset: () => void;
}

const DEFAULT_WATCHDOG_STATE: AdapterWatchdogState = {
  fallbackActive: false,
  fallbackReason: 'healthy',
  lastAuthoritativeAt: null,
  queueLatencyMs: 0,
};

const FALLBACK_SKETCH_TEMPLATE = {
  id: 'watchdog:fallback-line',
  kind: 'line',
  points: [
    [8, 8],
    [40, 14],
    [72, 48],
    [128, 24],
  ] as BoardPoint[],
  createdAt: 0,
  createdBy: 'system' as const,
  style: {
    strokeColor: '#3d63de',
    strokeWidth: 3,
  },
  zIndex: 1,
} satisfies BoardElement;

const BOARD_OP_KINDS: Array<BoardOp['type']> = [
  'upsertElement',
  'appendStrokePoints',
  'deleteElement',
  'offsetElement',
  'setElementGeometry',
  'setElementStyle',
  'setElementText',
  'duplicateElement',
  'setElementZIndex',
  'alignElements',
  'distributeElements',
  'clearBoard',
  'setViewport',
  'batch',
];

const BOARD_OP_KIND_SET = new Set(BOARD_OP_KINDS);

const cloneValue = <T>(value: T): T => {
  const structured = (globalThis as { structuredClone?: <TValue>(input: TValue) => TValue }).structuredClone;
  if (typeof structured === 'function') {
    return structured(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneEnvelope = (envelope: BoardOpsEnvelope): BoardOpsEnvelope => ({
  ...envelope,
  ops: cloneValue(envelope.ops),
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isBoardOpValue = (value: unknown): value is BoardOp => {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  if (typeof type !== 'string' || !BOARD_OP_KIND_SET.has(type as BoardOp['type'])) {
    return false;
  }
  if (type === 'batch') {
    return Array.isArray(value.ops) && value.ops.every((child) => isBoardOpValue(child));
  }
  return true;
};

const toFiniteTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

type EnvelopeStatus = 'valid' | 'empty_ops' | 'invalid_ops' | 'missing';

const evaluateBoardOpsEnvelope = (
  envelope: BoardOpsEnvelope | null | undefined,
): { status: EnvelopeStatus; envelope: BoardOpsEnvelope | null } => {
  if (!envelope) {
    return { status: 'missing', envelope: null };
  }
  if (envelope.kind !== 'board_ops' || typeof envelope.schemaVersion !== 'number' || !Array.isArray(envelope.ops)) {
    return { status: 'invalid_ops', envelope: null };
  }
  if (envelope.schemaVersion !== BOARD_OPS_SCHEMA_VERSION) {
    return { status: 'invalid_ops', envelope: null };
  }
  if (envelope.ops.length === 0) {
    return { status: 'empty_ops', envelope: null };
  }
  if (!envelope.ops.every(isBoardOpValue)) {
    return { status: 'invalid_ops', envelope: null };
  }
  return { status: 'valid', envelope };
};

const createDeterministicSketchFallbackOps = (): BoardOp[] => {
  const fallbackElement: BoardElement = {
    ...FALLBACK_SKETCH_TEMPLATE,
    points: FALLBACK_SKETCH_TEMPLATE.points.map(([x, y]) => [x, y] as BoardPoint),
  };
  return [
    { type: 'clearBoard' },
    {
      type: 'upsertElement',
      element: fallbackElement,
    },
  ];
};

const defaultWatchdogLogger = (message: string, context?: Record<string, unknown>) => {
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info(`${WATCHDOG_LOG_PREFIX} ${message}`, context);
  }
};

const createDefaultWatchdogState = (): AdapterWatchdogState => ({ ...DEFAULT_WATCHDOG_STATE });

export const createTldrawAdapterWatchdog = (options?: AdapterWatchdogOptions): TldrawAdapterWatchdog => {
  const maxQueueLatencyMs = options?.maxQueueLatencyMs ?? WATCHDOG_LATENCY_THRESHOLD_MS;
  const now = options?.now ?? (() => Date.now());
  const logger = options?.logger ?? defaultWatchdogLogger;
  const fallbackChangeCallback = options?.onFallbackChange;

  let state = createDefaultWatchdogState();
  let lastValidEnvelope: BoardOpsEnvelope | null = null;
  let lastReplayEnvelope: BoardOpsEnvelope | null = null;
  let lastQueueSampleAt: number | null = null;
  const subscribers = new Set<(snapshot: AdapterWatchdogState) => void>();

  const resolveQueueStartedAt = (receivedAt: number, sample?: WatchdogQueueSample): number => {
    const queuedTimestamp = toFiniteTimestamp(sample?.queuedAt);
    if (queuedTimestamp !== null) {
      lastQueueSampleAt = queuedTimestamp;
      return queuedTimestamp;
    }
    if (lastQueueSampleAt !== null) {
      const fallbackStart = lastQueueSampleAt;
      lastQueueSampleAt = receivedAt;
      return fallbackStart;
    }
    const fallbackStart = state.lastAuthoritativeAt ?? receivedAt;
    lastQueueSampleAt = receivedAt;
    return fallbackStart;
  };

  const notifySubscribers = () => {
    if (subscribers.size === 0) {
      return;
    }
    const snapshot = { ...state };
    subscribers.forEach((listener) => listener(snapshot));
  };

  const updateStateField = <K extends keyof AdapterWatchdogState>(key: K, value: AdapterWatchdogState[K]): boolean => {
    if (state[key] === value) {
      return false;
    }
    state = { ...state, [key]: value };
    return true;
  };

  const buildFallbackOps = (): BoardOp[] => {
    if (lastValidEnvelope) {
      lastReplayEnvelope = cloneEnvelope(lastValidEnvelope);
      return cloneValue(lastValidEnvelope.ops);
    }
    lastReplayEnvelope = null;
    return createDeterministicSketchFallbackOps();
  };

  const setFallback = (active: boolean, reason: AdapterFallbackReason): boolean => {
    const changed = state.fallbackActive !== active || state.fallbackReason !== reason;
    if (!changed) {
      return false;
    }
    state = { ...state, fallbackActive: active, fallbackReason: reason };
    const snapshot = { ...state };
    logger(active ? 'fallback enabled' : 'fallback cleared', {
      reason,
      lastAuthoritativeAt: snapshot.lastAuthoritativeAt,
      queueLatencyMs: snapshot.queueLatencyMs,
    });
    fallbackChangeCallback?.(snapshot);
    notifySubscribers();
    return true;
  };

  const recordIncoming: TldrawAdapterWatchdog['recordIncoming'] = (envelope, sample) => {
    const evaluation = evaluateBoardOpsEnvelope(envelope);
    const receivedAt = toFiniteTimestamp(sample?.receivedAt) ?? now();
    const queueStartedAt = resolveQueueStartedAt(receivedAt, sample);
    const queueLatencyMs = Math.max(0, receivedAt - queueStartedAt);
    let stateMutated = updateStateField('queueLatencyMs', queueLatencyMs);

    let fallbackReason: AdapterFallbackReason =
      evaluation.status === 'empty_ops' || evaluation.status === 'missing'
        ? 'empty_ops'
        : evaluation.status === 'invalid_ops'
          ? 'invalid_ops'
          : 'healthy';

    if (fallbackReason === 'healthy' && queueLatencyMs > maxQueueLatencyMs) {
      fallbackReason = 'latency';
    }

    const shouldAcceptEnvelope =
      fallbackReason === 'healthy' && evaluation.status === 'valid' && Boolean(evaluation.envelope);

    if (shouldAcceptEnvelope && evaluation.envelope) {
      stateMutated = updateStateField('lastAuthoritativeAt', receivedAt) || stateMutated;
      lastValidEnvelope = cloneEnvelope(evaluation.envelope);
      lastReplayEnvelope = null;
    }

    if (fallbackReason === 'healthy') {
      const fallbackChanged = setFallback(false, 'healthy');
      if (stateMutated && !fallbackChanged) {
        notifySubscribers();
      }
      return {
        ops: evaluation.envelope ? cloneValue(evaluation.envelope.ops) : [],
        fallbackApplied: false,
        replayedFromTranscript: false,
        reason: 'healthy',
      };
    }

    const fallbackOps = buildFallbackOps();
    const fallbackChanged = setFallback(true, fallbackReason);
    if (stateMutated && !fallbackChanged) {
      notifySubscribers();
    }
    return {
      ops: fallbackOps,
      fallbackApplied: true,
      replayedFromTranscript: lastReplayEnvelope !== null,
      reason: fallbackReason,
    };
  };

  const clampOutgoingOps: TldrawAdapterWatchdog['clampOutgoingOps'] = (ops) => {
    if (!state.fallbackActive) {
      return ops ? cloneValue(ops) : [];
    }
    return buildFallbackOps();
  };

  const subscribe: TldrawAdapterWatchdog['subscribe'] = (listener) => {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  };

  return {
    recordIncoming,
    clampOutgoingOps,
    getState: () => ({ ...state }),
    subscribe,
    getLastReplayEnvelope: () => (lastReplayEnvelope ? cloneEnvelope(lastReplayEnvelope) : null),
    reset: () => {
      state = createDefaultWatchdogState();
      lastValidEnvelope = null;
      lastReplayEnvelope = null;
      lastQueueSampleAt = null;
      notifySubscribers();
    },
  };
};

export const useTldrawAdapterWatchdogState = (watchdog: TldrawAdapterWatchdog | null): AdapterWatchdogState => {
  const [state, setState] = useState<AdapterWatchdogState>(() => ({ ...DEFAULT_WATCHDOG_STATE }));

  useEffect(() => {
    if (!watchdog) {
      setState({ ...DEFAULT_WATCHDOG_STATE });
      return;
    }
    setState(watchdog.getState());
    return watchdog.subscribe((next) => {
      setState(next);
    });
  }, [watchdog]);

  return state;
};

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

const SHAPE_TEXT_MAX_LENGTH = 4000;

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const isPositiveFiniteNumber = (value: unknown): value is number => {
  return isFiniteNumber(value) && value > 0;
};

const pointsHaveFiniteCoords = (points: TldrawDraftPoint[]): boolean => {
  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return false;
    }
  }
  return true;
};

type DraftShapeValidationResult = { ok: true } | { ok: false; reason: string; shapeId?: string };

const validateDraftShape = (shape: TldrawDraftShape): string | null => {
  if (!shape.id || typeof shape.id !== 'string') {
    return 'Shape id must be a non-empty string.';
  }
  if (!isFiniteNumber(shape.x) || !isFiniteNumber(shape.y) || !isFiniteNumber(shape.zIndex)) {
    return 'Shape coordinates and zIndex must be finite numbers.';
  }

  if (shape.kind === 'geo') {
    if (!isPositiveFiniteNumber(shape.props.w) || !isPositiveFiniteNumber(shape.props.h)) {
      return 'Geo shapes must include finite width and height.';
    }
    if (shape.props.text.length > SHAPE_TEXT_MAX_LENGTH) {
      return 'Geo labels exceed supported text length.';
    }
    return null;
  }

  if (shape.kind === 'frame') {
    if (!isPositiveFiniteNumber(shape.props.w) || !isPositiveFiniteNumber(shape.props.h)) {
      return 'Frame dimensions must be positive numbers.';
    }
    return null;
  }

  if (shape.kind === 'text') {
    if (!isFiniteNumber(shape.props.w) || shape.props.w <= 0) {
      return 'Text width must be a positive finite number.';
    }
    if (shape.props.text.length > SHAPE_TEXT_MAX_LENGTH) {
      return 'Text content exceeds supported length.';
    }
    return null;
  }

  if (shape.kind === 'line') {
    if (!Array.isArray(shape.props.points) || shape.props.points.length === 0) {
      return 'Line shapes must include at least one point.';
    }
    if (!pointsHaveFiniteCoords(shape.props.points)) {
      return 'Line points must be finite numbers.';
    }
    return null;
  }

  if (shape.kind === 'arrow') {
    const { start, end } = shape.props;
    if (!isFiniteNumber(start.x) || !isFiniteNumber(start.y) || !isFiniteNumber(end.x) || !isFiniteNumber(end.y)) {
      return 'Arrow endpoints must be finite numbers.';
    }
    return null;
  }

  return 'Unsupported shape kind provided.';
};

const validateDraftShapes = (shapes: TldrawDraftShape[]): DraftShapeValidationResult => {
  for (const shape of shapes) {
    const error = validateDraftShape(shape);
    if (error) {
      const shapeId = typeof shape.id === 'string' && shape.id.trim().length > 0 ? shape.id : undefined;
      return { ok: false, reason: error, shapeId };
    }
  }
  return { ok: true };
};

const cloneDraftShape = (shape: TldrawDraftShape): TldrawDraftShape => {
  return JSON.parse(JSON.stringify(shape)) as TldrawDraftShape;
};

interface ShapeSnapshot {
  shape: TldrawDraftShape;
  signature: string;
}

const createSnapshotMap = (drafts: TldrawDraftShape[]): {
  snapshot: Map<string, ShapeSnapshot>;
  signatures: Map<string, string>;
} => {
  const snapshot = new Map<string, ShapeSnapshot>();
  const signatures = new Map<string, string>();
  for (const draft of drafts) {
    const signature = JSON.stringify(draft);
    signatures.set(draft.id, signature);
    snapshot.set(draft.id, {
      shape: cloneDraftShape(draft),
      signature,
    });
  }
  return { snapshot, signatures };
};

const BATCHER_SKIP_MESSAGES = {
  invalidWindow: 'Transcript window id is required before diffing.',
  emptySnapshot: 'No shapes detected for transcript window.',
  noopDiff: 'No drawable differences detected for transcript window.',
} as const;

const formatInvalidShapeMessage = (reason: string, shapeId?: string): string => {
  if (shapeId) {
    return `Invalid draft shape ${shapeId}: ${reason}`;
  }
  return `Invalid draft shape: ${reason}`;
};

const normalizeTranscriptWindowId = (value: string): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export interface TranscriptWindowBatchInput {
  transcriptWindowId: string;
  board: BoardState | null | undefined;
  showAiNotes: boolean;
}

interface TranscriptWindowBatchDiff {
  kind: 'diff';
  transcriptWindowId: string;
  created: TldrawDraftShape[];
  updated: TldrawDraftShape[];
  deleted: string[];
}

type TranscriptWindowSkipReason =
  | {
      reason: 'invalid_window';
      message: string;
    }
  | {
      reason: 'noop';
      message: string;
    }
  | {
      reason: 'invalid_shapes';
      message: string;
      invalidShapeId?: string;
    };

interface TranscriptWindowBatchSkipped extends TranscriptWindowSkipReason {
  kind: 'skipped';
  transcriptWindowId: string;
}

export type TranscriptWindowBatchResult = TranscriptWindowBatchDiff | TranscriptWindowBatchSkipped;

export class TranscriptWindowShapeBatcher {
  private snapshots = new Map<string, Map<string, ShapeSnapshot>>();

  process(input: TranscriptWindowBatchInput): TranscriptWindowBatchResult {
    const normalizedWindowId = normalizeTranscriptWindowId(input.transcriptWindowId);
    if (!normalizedWindowId) {
      return this.buildSkip('', { reason: 'invalid_window', message: BATCHER_SKIP_MESSAGES.invalidWindow });
    }

    const drafts = boardToTldrawDraftShapes(input.board, input.showAiNotes);
    const validation = validateDraftShapes(drafts);
    if (!validation.ok) {
      return this.buildSkip(normalizedWindowId, {
        reason: 'invalid_shapes',
        message: formatInvalidShapeMessage(validation.reason, validation.shapeId),
        invalidShapeId: validation.shapeId,
      });
    }

    return this.diffAgainstWindow(normalizedWindowId, drafts);
  }

  clear(windowId?: string): void {
    const normalizedWindowId = normalizeTranscriptWindowId(windowId ?? '');
    if (normalizedWindowId) {
      this.snapshots.delete(normalizedWindowId);
      return;
    }
    this.snapshots.clear();
  }

  private diffAgainstWindow(windowId: string, drafts: TldrawDraftShape[]): TranscriptWindowBatchResult {
    const { snapshot: nextSnapshot, signatures } = createSnapshotMap(drafts);
    const previousSnapshot = this.snapshots.get(windowId);

    if (!previousSnapshot) {
      this.snapshots.set(windowId, nextSnapshot);
      if (nextSnapshot.size === 0) {
        return this.buildSkip(windowId, { reason: 'noop', message: BATCHER_SKIP_MESSAGES.emptySnapshot });
      }
      return this.buildDiff(windowId, {
        created: drafts.map((shape) => cloneDraftShape(shape)),
        updated: [],
        deleted: [],
      });
    }

    const created: TldrawDraftShape[] = [];
    const updated: TldrawDraftShape[] = [];
    const deleted: string[] = [];

    for (const draft of drafts) {
      const signature = signatures.get(draft.id);
      const previous = previousSnapshot.get(draft.id);
      if (!previous) {
        created.push(cloneDraftShape(draft));
        continue;
      }
      if (signature && previous.signature !== signature) {
        updated.push(cloneDraftShape(draft));
      }
    }

    for (const [id] of previousSnapshot) {
      if (!signatures.has(id)) {
        deleted.push(id);
      }
    }

    this.snapshots.set(windowId, nextSnapshot);

    if (created.length === 0 && updated.length === 0 && deleted.length === 0) {
      return this.buildSkip(windowId, { reason: 'noop', message: BATCHER_SKIP_MESSAGES.noopDiff });
    }

    return this.buildDiff(windowId, { created, updated, deleted });
  }

  private buildSkip(windowId: string, skip: TranscriptWindowSkipReason): TranscriptWindowBatchSkipped {
    return {
      kind: 'skipped',
      transcriptWindowId: windowId,
      ...skip,
    };
  }

  private buildDiff(
    windowId: string,
    diff: { created: TldrawDraftShape[]; updated: TldrawDraftShape[]; deleted: string[] },
  ): TranscriptWindowBatchDiff {
    return {
      kind: 'diff',
      transcriptWindowId: windowId,
      ...diff,
    };
  }
}
