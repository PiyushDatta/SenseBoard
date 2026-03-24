/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { BOARD_OPS_SCHEMA_VERSION } from '../../../shared/types';
import type { BoardOp, BoardOpsEnvelope } from '../../../shared/types';
import {
  createTldrawAdapterWatchdog,
  type AdapterWatchdogState,
} from './canvas-surface.tldraw-adapter';

const createEnvelope = (ops: BoardOp[]): BoardOpsEnvelope => ({
  kind: 'board_ops',
  schemaVersion: BOARD_OPS_SCHEMA_VERSION,
  ops,
});

const findUpsert = (ops: BoardOp[]) =>
  ops.find((op): op is Extract<BoardOp, { type: 'upsertElement' }> => op.type === 'upsertElement');

describe('tldraw adapter watchdog', () => {
  it('records healthy envelopes without triggering fallback', () => {
    const watchdog = createTldrawAdapterWatchdog({ now: () => 200 });
    const envelope = createEnvelope([{ type: 'clearBoard' }]);
    const result = watchdog.recordIncoming(envelope, { queuedAt: 180, receivedAt: 200 });

    expect(result.fallbackApplied).toBe(false);
    expect(result.ops).toEqual(envelope.ops);

    const state = watchdog.getState();
    expect(state.lastAuthoritativeAt).toBe(200);
    expect(state.queueLatencyMs).toBe(20);
    expect(state.fallbackActive).toBe(false);
  });

  it('replays the prior transcript diff when latency exceeds the threshold', () => {
    let nowTick = 0;
    const watchdog = createTldrawAdapterWatchdog({ now: () => nowTick });
    const firstEnvelope = createEnvelope([{ type: 'clearBoard' }]);
    const delayedEnvelope = createEnvelope([
      { type: 'setViewport', viewport: { x: 10, y: 20, zoom: 1 } },
    ]);

    watchdog.recordIncoming(firstEnvelope, { queuedAt: 0, receivedAt: 0 });

    nowTick = 2500;
    const result = watchdog.recordIncoming(delayedEnvelope, { queuedAt: 0, receivedAt: 2500 });

    expect(result.fallbackApplied).toBe(true);
    expect(result.replayedFromTranscript).toBe(true);
    expect(result.reason).toBe('latency');
    expect(result.ops).toEqual(firstEnvelope.ops);
    expect(watchdog.getLastReplayEnvelope()?.ops).toEqual(firstEnvelope.ops);
    expect(watchdog.getState().lastAuthoritativeAt).toBe(0);
  });

  it('generates a deterministic fallback sketch when no transcript is available', () => {
    const watchdog = createTldrawAdapterWatchdog({ now: () => 0 });
    const result = watchdog.recordIncoming(null);

    expect(result.fallbackApplied).toBe(true);
    expect(result.replayedFromTranscript).toBe(false);
    const upsert = findUpsert(result.ops);
    expect(upsert?.element?.id).toBe('watchdog:fallback-line');
  });

  it('clamps outgoing ops to the last valid transcript while fallback is active', () => {
    const watchdog = createTldrawAdapterWatchdog({ now: () => 0 });
    const baseline = createEnvelope([{ type: 'clearBoard' }]);
    watchdog.recordIncoming(baseline, { queuedAt: 0, receivedAt: 0 });

    const emptyEnvelope = {
      kind: 'board_ops',
      schemaVersion: BOARD_OPS_SCHEMA_VERSION,
      ops: [],
    } as BoardOpsEnvelope;
    const result = watchdog.recordIncoming(emptyEnvelope);

    expect(result.reason).toBe('empty_ops');
    expect(result.replayedFromTranscript).toBe(true);
    expect(watchdog.getState().fallbackActive).toBe(true);

    const clamped = watchdog.clampOutgoingOps([
      { type: 'setViewport', viewport: { x: 0, y: 0, zoom: 2 } },
    ]);
    expect(clamped).toEqual(baseline.ops);
  });

  it('logs fallback toggles and publishes snapshots through the callback', () => {
    const logs: Array<{ message: string; reason?: string }> = [];
    const snapshots: AdapterWatchdogState[] = [];
    const watchdog = createTldrawAdapterWatchdog({
      now: () => 0,
      logger: (message, context) => {
        logs.push({ message, reason: (context?.reason as string) ?? undefined });
      },
      onFallbackChange: (snapshot) => snapshots.push(snapshot),
    });

    watchdog.recordIncoming(null);
    watchdog.recordIncoming(createEnvelope([{ type: 'clearBoard' }]), { queuedAt: 0, receivedAt: 0 });

    expect(logs.some((entry) => entry.message.includes('fallback enabled'))).toBe(true);
    expect(logs.some((entry) => entry.message.includes('fallback cleared'))).toBe(true);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]?.fallbackActive).toBe(true);
    expect(snapshots[snapshots.length - 1]?.fallbackActive).toBe(false);
  });

  it('derives queue latency from internal bookkeeping when queuedAt is missing', () => {
    let nowTick = 0;
    const watchdog = createTldrawAdapterWatchdog({ now: () => nowTick });
    const envelope = createEnvelope([{ type: 'clearBoard' }]);

    watchdog.recordIncoming(envelope, { receivedAt: nowTick });

    nowTick = 2200;
    const result = watchdog.recordIncoming(envelope, { receivedAt: nowTick });

    expect(result.reason).toBe('latency');
    expect(result.fallbackApplied).toBe(true);
    expect(result.replayedFromTranscript).toBe(true);
    expect(watchdog.getState().queueLatencyMs).toBeGreaterThanOrEqual(2200);
    expect(watchdog.getState().lastAuthoritativeAt).toBe(0);
  });
});
