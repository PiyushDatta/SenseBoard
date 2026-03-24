import type { BoardElement, BoardOp, BoardOpsEnvelope } from '../../../../shared/types';
import { BOARD_OPS_SCHEMA_VERSION } from '../../../../shared/types';
import {
  AI_ELEMENT_BOUNDS,
  CANVAS_ELEMENT_BOUNDS,
  DEFAULT_BURST_THRESHOLD,
  DEFAULT_BURST_WINDOW_MS,
  DEFAULT_PROVIDER_TAG,
} from './constants';
import { clampNumber } from './numeric';
import { clampSingleBoardOp } from './op-clamp';
import { createTranscriptBurstTracker, defaultBurstTracker, type TranscriptBurstTracker } from './burst-tracker';
import {
  buildGuardTelemetry,
  registerSkipReason,
  type BoardOpsGuardTelemetry,
} from './telemetry';

const hashSeed = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const buildDeterministicFallbackOps = (seed: string, now: number): BoardOp[] => {
  const hash = hashSeed(seed);
  const laneWidth = Math.max(1, AI_ELEMENT_BOUNDS.maxX - AI_ELEMENT_BOUNDS.minX);
  const laneOffset = hash % laneWidth;
  const baseX = clampNumber(
    AI_ELEMENT_BOUNDS.minX + 40 + laneOffset,
    AI_ELEMENT_BOUNDS.minX + 40,
    AI_ELEMENT_BOUNDS.maxX - 240,
  );
  const baseY = clampNumber(
    CANVAS_ELEMENT_BOUNDS.minY + 120 + (hash % 200),
    CANVAS_ELEMENT_BOUNDS.minY + 80,
    CANVAS_ELEMENT_BOUNDS.maxY - 240,
  );
  const connectorEndX = clampNumber(baseX + 320, AI_ELEMENT_BOUNDS.minX + 120, AI_ELEMENT_BOUNDS.maxX - 40);

  const fallbackElements: BoardElement[] = [
    {
      id: `guard:text:${seed}`,
      kind: 'text',
      x: baseX,
      y: baseY,
      text: 'Capturing the spoken flow while board ops stabilize.',
      createdAt: now,
      createdBy: 'ai',
    },
    {
      id: `guard:connector:${seed}`,
      kind: 'arrow',
      points: [
        [baseX + 40, baseY + 120],
        [connectorEndX, baseY + 120],
      ],
      createdAt: now,
      createdBy: 'ai',
    },
    {
      id: `guard:note:${seed}`,
      kind: 'text',
      x: connectorEndX - 40,
      y: baseY + 96,
      text: 'Placeholder connectors rendered deterministically.',
      createdAt: now,
      createdBy: 'ai',
    },
  ];

  return fallbackElements.map<BoardOp>((element) => ({ type: 'upsertElement', element }));
};

export interface BoardOpsGuardNotice {
  kind: 'board_ops_guard';
  message: string;
  telemetry: BoardOpsGuardTelemetry;
}

export type BoardOpsGuardLogger = (entry: {
  severity: 'debug' | 'info' | 'warn';
  message: string;
  telemetry: BoardOpsGuardTelemetry;
}) => void;

export interface BoardOpsGuardOptions {
  providerTag?: string;
  burstKey?: string;
  now?: number;
  burstThreshold?: number;
  burstWindowMs?: number;
  logger?: BoardOpsGuardLogger;
  onNotice?: (notice: BoardOpsGuardNotice) => void;
  burstTracker?: TranscriptBurstTracker;
}

export interface BoardOpsGuardResult {
  ops: BoardOp[];
  telemetry: BoardOpsGuardTelemetry;
  fallbackApplied: boolean;
}

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
      // Ignore environments without CustomEvent.
    }
  }
  console.warn('[host-notice]', notice.message, notice.telemetry);
};

const trackTranscriptBurst = (
  tracker: TranscriptBurstTracker,
  key: string,
  invalidPayload: boolean,
  now: number,
  threshold: number,
  windowMs: number,
) => tracker.track(key, invalidPayload, now, threshold, windowMs);

export const guardBoardOpsEnvelope = (
  envelope: BoardOpsEnvelope | null | undefined,
  options?: BoardOpsGuardOptions,
): BoardOpsGuardResult => {
  const providerTag = options?.providerTag ?? DEFAULT_PROVIDER_TAG;
  const burstKey = options?.burstKey ?? providerTag;
  const now = options?.now ?? Date.now();
  const logger = options?.logger ?? defaultGuardLogger;
  const noticeEmitter = options?.onNotice ?? defaultHostNoticeEmitter;
  const tracker = options?.burstTracker ?? defaultBurstTracker;
  const clampReasons = new Set<string>();
  const skipReasons = new Map<string, number>();
  const hasEnvelope = envelope !== null && envelope !== undefined;
  if (!hasEnvelope) {
    registerSkipReason(skipReasons, 'envelope:missing');
  }
  const kindValid = hasEnvelope && envelope!.kind === 'board_ops';
  if (hasEnvelope && !kindValid) {
    registerSkipReason(skipReasons, 'envelope:kind');
  }
  const opsValid = hasEnvelope && Array.isArray(envelope!.ops);
  if (hasEnvelope && !opsValid) {
    registerSkipReason(skipReasons, 'envelope:ops');
  }
  const envelopeInvalid = !hasEnvelope || !kindValid || !opsValid;
  const rawOps = kindValid && opsValid ? (envelope!.ops as BoardOp[]) : [];

  const sanitizedOps: BoardOp[] = [];
  let clampedFields = 0;
  let skippedTopLevel = 0;
  let skippedNested = 0;
  let schemaVersion = 0;
  if (hasEnvelope) {
    const schemaField = envelope!.schemaVersion;
    const hasNumericSchema = typeof schemaField === 'number' && Number.isFinite(schemaField);
    const schemaInput = hasNumericSchema ? (schemaField as number) : 0;
    schemaVersion = clampNumber(schemaInput, 0, BOARD_OPS_SCHEMA_VERSION);
    if (!hasNumericSchema || schemaVersion !== schemaInput) {
      clampReasons.add('schema:version');
      clampedFields += 1;
    }
  }

  for (const raw of rawOps) {
    const result = clampSingleBoardOp(raw as BoardOp, clampReasons, skipReasons, now);
    if (result) {
      sanitizedOps.push(result.op);
      clampedFields += result.clamped;
      skippedNested += result.skippedChildren;
    } else {
      skippedTopLevel += 1;
    }
  }

  const { burstCount, triggered } = trackTranscriptBurst(
    tracker,
    burstKey,
    sanitizedOps.length === 0,
    now,
    options?.burstThreshold ?? DEFAULT_BURST_THRESHOLD,
    options?.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS,
  );

  let fallbackApplied = false;
  let forwardedOps = sanitizedOps;

  if (sanitizedOps.length === 0 && triggered) {
    fallbackApplied = true;
    forwardedOps = buildDeterministicFallbackOps(burstKey, now);
    clampReasons.add('fallback:transcript_burst');
  }

  const telemetry = buildGuardTelemetry({
    providerTag,
    schemaVersion,
    receivedOps: rawOps.length,
    forwardedOps: forwardedOps.length,
    skippedTopLevel,
    skippedNested,
    clampedFields,
    clampReasons,
    skipReasons,
    fallbackApplied,
    burstCount,
    burstKey,
    envelopeInvalid,
  });

  const guardIntervened =
    envelopeInvalid || fallbackApplied || telemetry.clampedOps > 0 || telemetry.skippedOps > 0;
  if (guardIntervened) {
    let severity: 'warn' | 'info' | 'debug' = 'debug';
    let message: string;
    let noticeMessage: string;
    if (fallbackApplied) {
      severity = 'warn';
      message = `Fallback board_ops applied after ${burstCount} rapid transcript bursts (${providerTag}).`;
      noticeMessage = 'Rendered deterministic connectors while AI recovers.';
    } else if (telemetry.envelopeInvalid) {
      severity = 'warn';
      message = `Discarded invalid board_ops envelope for provider=${providerTag}.`;
      noticeMessage = 'Incoming board ops rejected as invalid.';
    } else if (telemetry.clampedOps > 0) {
      severity = 'info';
      message = `Sanitized ${telemetry.clampedOps} board_ops fields for provider=${providerTag}.`;
      noticeMessage = 'Board ops sanitized before rendering.';
    } else {
      severity = 'debug';
      message = `Skipped ${telemetry.skippedOps} board_ops entries for provider=${providerTag}.`;
      noticeMessage = 'Board ops skipped after validation.';
    }
    logger({ severity, message, telemetry });
    noticeEmitter({
      kind: 'board_ops_guard',
      message: noticeMessage,
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

export const createIsolatedBurstTracker = () => createTranscriptBurstTracker();

export const resetDefaultBurstTracker = () => {
  defaultBurstTracker.reset();
};

export type { BoardOpsGuardTelemetry } from './telemetry';
export type { TranscriptBurstTracker } from './burst-tracker';
