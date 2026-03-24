import type { BoardElement, BoardOp } from '../../../shared/types';
import {
  BOARD_OP_GUARD_MAX_COORD,
  BOARD_OP_GUARD_MAX_DELTA,
  BOARD_OP_GUARD_MAX_STYLE_CHARS,
  BOARD_OP_GUARD_MAX_TEXT_LENGTH,
  BOARD_OP_GUARD_MAX_ZOOM,
  BOARD_OP_GUARD_MIN_ZOOM,
  BOARD_OP_GUARD_PROVIDER_UNKNOWN,
  createBoardOpGuardContext,
  sanitizeBoardOps,
  type BoardOpGuardContext,
  type GuardReasonRecord,
} from './sanitizers';
import {
  type BoardOpGuardHostNotice,
  type BoardOpGuardHostNoticeHandler,
  type BoardOpGuardTelemetryEvent,
  type BoardOpGuardTelemetryHandler,
  type GuardFallbackSequenceStore,
  clearAllFallbackSequences,
  clearBoardOpGuardHostNoticeHandlers,
  clearBoardOpGuardTelemetryHandlers,
  createGuardFallbackSequenceStore,
  deleteFallbackSequenceByKey,
  deleteFallbackSequencesBySuffix,
  emitBoardOpGuardTelemetryForScope,
  getNextGuardFallbackSequence,
  notifyBoardOpGuardHostForScope,
  setBoardOpGuardHostNoticeHandlerForScope,
  setBoardOpGuardTelemetryHandlerForScope,
  setGuardFallbackSequenceStore,
} from './state';

const BOARD_OP_GUARD_DEFAULT_SCOPE = 'default';

const sanitizeGuardScopeSegment = (value?: string): string => {
  if (!value) {
    return BOARD_OP_GUARD_DEFAULT_SCOPE;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : BOARD_OP_GUARD_DEFAULT_SCOPE;
};

const toGuardScopeKey = (scope?: string): string => sanitizeGuardScopeSegment(scope ?? BOARD_OP_GUARD_DEFAULT_SCOPE);

const makeGuardFallbackScopeKey = (providerTag: string, fallbackSeed?: string): string => {
  const providerSegment = sanitizeGuardScopeSegment(providerTag || BOARD_OP_GUARD_PROVIDER_UNKNOWN);
  const seedSegment = sanitizeGuardScopeSegment(fallbackSeed);
  return `${providerSegment}:${seedSegment}`;
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
  sequenceStore?: GuardFallbackSequenceStore;
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

export const setBoardOpGuardTelemetryHandler = (
  handler: BoardOpGuardTelemetryHandler | null,
  scope?: string,
) => {
  setBoardOpGuardTelemetryHandlerForScope(handler, toGuardScopeKey(scope));
};

export const setBoardOpGuardHostNoticeHandler = (
  handler: BoardOpGuardHostNoticeHandler | null,
  scope?: string,
) => {
  setBoardOpGuardHostNoticeHandlerForScope(handler, toGuardScopeKey(scope));
};

export const resetBoardOpGuardScope = (scope?: string, providerTag?: string, fallbackSeed?: string) => {
  if (!scope) {
    clearBoardOpGuardTelemetryHandlers();
    clearBoardOpGuardHostNoticeHandlers();
    clearAllFallbackSequences();
    return;
  }
  const scopeKey = toGuardScopeKey(scope);
  setBoardOpGuardTelemetryHandlerForScope(null, scopeKey);
  setBoardOpGuardHostNoticeHandlerForScope(null, scopeKey);

  const seedSegment = sanitizeGuardScopeSegment(fallbackSeed ?? scopeKey);
  if (providerTag) {
    const providerSegment = sanitizeGuardScopeSegment(providerTag);
    deleteFallbackSequenceByKey(`${providerSegment}:${seedSegment}`);
    return;
  }
  deleteFallbackSequencesBySuffix(`:${seedSegment}`);
};

export const guardBoardOpsForTldraw = (
  ops: BoardOp[] | null | undefined,
  options?: BoardOpGuardOptions,
): BoardOpGuardResult => {
  const providerTag = options?.providerTag?.trim() || BOARD_OP_GUARD_PROVIDER_UNKNOWN;
  const maxDelta = Math.max(1, options?.maxDeltaMagnitude ?? BOARD_OP_GUARD_MAX_DELTA);
  const runtimeScopeKey = toGuardScopeKey(options?.runtimeScope);
  const ctx: BoardOpGuardContext = createBoardOpGuardContext(maxDelta);

  const sourceOps = Array.isArray(ops) ? ops : [];
  const sanitizedOps = sanitizeBoardOps(sourceOps, ctx);
  const intervened = ctx.droppedOps > 0 || ctx.clampedOps > 0;
  const fallbackScopeKey = makeGuardFallbackScopeKey(providerTag, options?.fallbackSeed ?? runtimeScopeKey);
  const fallbackSequence = intervened
    ? getNextGuardFallbackSequence(fallbackScopeKey, options?.sequenceStore)
    : 0;
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
    emitBoardOpGuardTelemetryForScope(runtimeScopeKey, {
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

    notifyBoardOpGuardHostForScope(runtimeScopeKey, {
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

export {
  BOARD_OP_GUARD_MAX_COORD,
  BOARD_OP_GUARD_MAX_DELTA,
  BOARD_OP_GUARD_MAX_STYLE_CHARS,
  BOARD_OP_GUARD_MAX_TEXT_LENGTH,
  BOARD_OP_GUARD_MAX_ZOOM,
  BOARD_OP_GUARD_MIN_ZOOM,
  BOARD_OP_GUARD_PROVIDER_UNKNOWN,
  createGuardFallbackSequenceStore,
  sanitizeBoardOps,
  setGuardFallbackSequenceStore,
};

export type {
  BoardOpGuardHostNotice,
  BoardOpGuardHostNoticeHandler,
  BoardOpGuardTelemetryEvent,
  BoardOpGuardTelemetryHandler,
  GuardFallbackSequenceStore,
  GuardReasonRecord,
};
