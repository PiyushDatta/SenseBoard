/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from 'bun:test';

import type { BoardElement, BoardOp } from '../../../shared/types';
import {
  BOARD_OP_GUARD_MAX_STYLE_CHARS,
  BOARD_OP_GUARD_MAX_TEXT_LENGTH,
  createGuardFallbackSequenceStore,
  guardBoardOpsForTldraw,
  resetBoardOpGuardScope,
  setBoardOpGuardHostNoticeHandler,
  setBoardOpGuardTelemetryHandler,
  setGuardFallbackSequenceStore,
  type BoardOpGuardHostNotice,
  type BoardOpGuardTelemetryEvent,
} from './board-op-guard';

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
    setGuardFallbackSequenceStore(null);
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

  it('resets fallback scope state across providers when only scope is provided', () => {
    const guardOptions = {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
    } as const;

    const first = guardBoardOpsForTldraw(droppingOps, guardOptions);
    const second = guardBoardOpsForTldraw(droppingOps, guardOptions);
    expect(second.fallbackOps).not.toEqual(first.fallbackOps);

    resetBoardOpGuardScope(TEST_SCOPE);
    const third = guardBoardOpsForTldraw(droppingOps, guardOptions);

    expect(third.fallbackOps).toEqual(first.fallbackOps);
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

  it('normalizes ids, authors, and sticky text payloads during upserts', () => {
    const sticky = {
      id: '  messy-id  ',
      kind: 'sticky',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      text: `${'A'.repeat(BOARD_OP_GUARD_MAX_TEXT_LENGTH)} extra whitespace`,
      createdAt: 10,
      createdBy: ' AI ' as unknown as BoardElement['createdBy'],
    } as unknown as BoardElement;

    const result = guardBoardOpsForTldraw(
      [
        {
          type: 'upsertElement',
          element: sticky,
        },
      ],
      { providerTag: TEST_PROVIDER },
    );

    expect(result.clampReasons).toHaveProperty('element_id', 1);
    expect(result.clampReasons).toHaveProperty('element_author', 1);
    expect(result.clampReasons).toHaveProperty('sticky_text', 1);

    const sanitized = result.sanitizedOps[0] as Extract<BoardOp, { type: 'upsertElement' }>;
    expect(sanitized.element.id).toBe('messy-id');
    expect(sanitized.element.createdBy).toBe('ai');
    expect(sanitized.element.text.length).toBe(BOARD_OP_GUARD_MAX_TEXT_LENGTH);
  });

  it('records drop reasons for malformed ops inside nested batches', () => {
    const malformedBatch: BoardOp = {
      type: 'batch',
      ops: [
        { type: 'deleteElement', id: '' },
        { type: 'setElementStyle', id: 'style-target', style: {} as BoardElement['style'] },
      ],
    };

    const result = guardBoardOpsForTldraw([malformedBatch], { providerTag: TEST_PROVIDER });

    expect(result.droppedOps).toBe(3);
    expect(result.dropReasons).toMatchObject({
      invalid_delete_id: 1,
      empty_style: 1,
      empty_batch: 1,
    });
  });

  it('clamps oversized text and style payloads while counting clamp reasons', () => {
    const stylePayload = { strokeColor: ` ${'#abcd'.repeat(80)} ` } as Partial<BoardElement['style']>;
    const textPayload = `${'Z'.repeat(BOARD_OP_GUARD_MAX_TEXT_LENGTH + 32)}    `;

    const result = guardBoardOpsForTldraw(
      [
        { type: 'setElementText', id: '  text  ', text: textPayload },
        { type: 'setElementStyle', id: 'style', style: stylePayload },
      ],
      { providerTag: TEST_PROVIDER },
    );

    expect(result.clampReasons).toHaveProperty('text_value', 1);
    expect(result.clampReasons).toHaveProperty('style_payload', 1);

    const textOp = result.sanitizedOps[0] as Extract<BoardOp, { type: 'setElementText' }>;
    expect(textOp.text.length).toBe(BOARD_OP_GUARD_MAX_TEXT_LENGTH);

    const styleOp = result.sanitizedOps[1] as Extract<BoardOp, { type: 'setElementStyle' }>;
    expect(styleOp.style.strokeColor?.length).toBeLessThanOrEqual(BOARD_OP_GUARD_MAX_STYLE_CHARS);
  });

  it('allows injecting deterministic fallback stores for guard fallbacks', () => {
    const store = createGuardFallbackSequenceStore();
    const guardOptions = {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
      sequenceStore: store,
    } as const;

    const first = guardBoardOpsForTldraw(droppingOps, guardOptions);
    const second = guardBoardOpsForTldraw(droppingOps, guardOptions);
    expect(second.fallbackOps).not.toEqual(first.fallbackOps);

    store.clear();
    const reset = guardBoardOpsForTldraw(droppingOps, guardOptions);
    expect(reset.fallbackOps).toEqual(first.fallbackOps);
  });

  it('supports overriding the global fallback store for deterministic runs', () => {
    const customStore = createGuardFallbackSequenceStore();
    setGuardFallbackSequenceStore(customStore);

    const baseline = guardBoardOpsForTldraw(droppingOps, {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
    });

    customStore.clear();
    const rerun = guardBoardOpsForTldraw(droppingOps, {
      providerTag: TEST_PROVIDER,
      runtimeScope: TEST_SCOPE,
    });

    expect(rerun.fallbackOps).toEqual(baseline.fallbackOps);
  });
});
