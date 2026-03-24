/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from 'bun:test';

import type { BoardOp } from '../../../shared/types';
import {
  guardBoardOpsForTldraw,
  resetBoardOpGuardScope,
  setBoardOpGuardHostNoticeHandler,
  setBoardOpGuardTelemetryHandler,
  type BoardOpGuardHostNotice,
  type BoardOpGuardTelemetryEvent,
} from './canvas-surface.tldraw-adapter';

const TEST_PROVIDER = 'openai';
const TEST_SCOPE = 'guard-test-scope';

const droppingOps: BoardOp[] = [
  { type: 'deleteElement', id: '' },
];

const clampingOps: BoardOp[] = [
  { type: 'setViewport', viewport: { zoom: 99, x: 999999, y: -999999 } },
];

describe('board op guard instrumentation', () => {
  afterEach(() => {
    resetBoardOpGuardScope();
    setBoardOpGuardTelemetryHandler(null);
    setBoardOpGuardHostNoticeHandler(null);
  });

  it('emits structured telemetry and host notices when guard intervenes', () => {
    const telemetryEvents: BoardOpGuardTelemetryEvent[] = [];
    let hostNotice: BoardOpGuardHostNotice | null = null;

    setBoardOpGuardTelemetryHandler((event) => telemetryEvents.push(event), TEST_SCOPE);
    setBoardOpGuardHostNoticeHandler((notice) => {
      hostNotice = notice;
    }, TEST_SCOPE);

    const result = guardBoardOpsForTldraw(droppingOps, {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
    });

    expect(result.intervened).toBe(true);
    expect(result.droppedOps).toBe(1);
    expect(result.clampedOps).toBe(0);
    expect(result.fallbackOps.length).toBeGreaterThan(0);

    expect(telemetryEvents).toHaveLength(1);
    const event = telemetryEvents[0];
    expect(event.providerTag).toBe(TEST_PROVIDER);
    expect(event.scopeKey).toBe(TEST_SCOPE);
    expect(event.totalOps).toBe(1);
    expect(event.droppedOps).toBe(1);
    expect(event.clampedOps).toBe(0);
    expect(event.fallbackOps).toBe(result.fallbackOps.length);
    expect(event.dropReasons).toHaveProperty('invalid_delete_id', 1);

    expect(hostNotice).not.toBeNull();
    expect(hostNotice?.providerTag).toBe(TEST_PROVIDER);
    expect(hostNotice?.scopeKey).toBe(TEST_SCOPE);
    expect(hostNotice?.droppedOps).toBe(1);
    expect(hostNotice?.clampedOps).toBe(0);
  });

  it('produces deterministic fallback ops for a scope/provider when reset', () => {
    const guardOptions = {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
      fallbackSeed: TEST_SCOPE,
    } as const;

    const first = guardBoardOpsForTldraw(droppingOps, guardOptions);
    resetBoardOpGuardScope(TEST_SCOPE, TEST_PROVIDER, TEST_SCOPE);
    const second = guardBoardOpsForTldraw(droppingOps, guardOptions);

    expect(first.intervened).toBe(true);
    expect(second.intervened).toBe(true);
    expect(first.fallbackOps).toEqual(second.fallbackOps);
  });

  it('clamps oversized viewport ops and records clamp reasons', () => {
    const result = guardBoardOpsForTldraw(clampingOps, { providerTag: TEST_PROVIDER });

    expect(result.intervened).toBe(true);
    expect(result.clampedOps).toBe(1);
    expect(result.clampReasons).toHaveProperty('viewport_zoom', 1);
    expect(result.clampReasons).toHaveProperty('viewport_x', 1);
    expect(result.clampReasons).toHaveProperty('viewport_y', 1);

    expect(result.sanitizedOps).toEqual([
      {
        type: 'setViewport',
        viewport: {
          zoom: 5,
          x: 200000,
          y: -200000,
        },
      },
    ]);
  });

  it('does not emit instrumentation when ops are already safe', () => {
    const telemetryEvents: BoardOpGuardTelemetryEvent[] = [];
    setBoardOpGuardTelemetryHandler((event) => telemetryEvents.push(event), TEST_SCOPE);
    let hostNotice: BoardOpGuardHostNotice | null = null;
    setBoardOpGuardHostNoticeHandler((notice) => {
      hostNotice = notice;
    }, TEST_SCOPE);

    const safeOps: BoardOp[] = [
      {
        type: 'setViewport',
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    ];
    const result = guardBoardOpsForTldraw(safeOps, {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
    });

    expect(result.intervened).toBe(false);
    expect(result.fallbackOps).toHaveLength(0);
    expect(telemetryEvents).toHaveLength(0);
    expect(hostNotice).toBeNull();
  });
});
