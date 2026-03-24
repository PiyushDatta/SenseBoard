/// <reference types="bun-types" />

import { beforeEach, describe, expect, it } from 'bun:test';

import {
  __testInternals,
  guardBoardOpsEnvelope,
} from './canvas-surface.tldraw-adapter';
import {
  SENSEBOARD_AI_CONTENT_MAX_X,
  SENSEBOARD_AI_CONTENT_MIN_X,
  SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
  SENSEBOARD_AI_ELEMENT_MAX_WIDTH,
  SENSEBOARD_CANVAS_HEIGHT,
  SENSEBOARD_CANVAS_PADDING,
  SENSEBOARD_CANVAS_WIDTH,
} from '../../../shared/board-dimensions';
import type { BoardOp, BoardOpsEnvelope } from '../../../shared/types';

const { clampSingleBoardOp, resetTranscriptBurstHistory } = __testInternals;

const baseEnvelope = (ops: BoardOp[]): BoardOpsEnvelope => ({
  kind: 'board_ops',
  schemaVersion: 1,
  ops,
});

const runGuard = (envelope: BoardOpsEnvelope, overrides: Parameters<typeof guardBoardOpsEnvelope>[1] = {}) => {
  return guardBoardOpsEnvelope(envelope, {
    providerTag: 'test-provider',
    burstKey: 'test-burst',
    logger: () => {},
    onNotice: () => {},
    ...overrides,
  });
};

describe('clampSingleBoardOp', () => {
  it('trims setElementText payloads and rejects whitespace-only input', () => {
    const trimmed = clampSingleBoardOp(
      { type: 'setElementText', id: 'label-1', text: '  Keep me  ' },
      new Set(),
      new Map(),
    );
    expect(trimmed?.op.type).toBe('setElementText');
    if (trimmed?.op.type === 'setElementText') {
      expect(trimmed.op.text).toBe('Keep me');
    }

    const skipReasons = new Map<string, number>();
    const rejected = clampSingleBoardOp(
      { type: 'setElementText', id: 'label-2', text: '   \n  ' },
      new Set(),
      skipReasons,
    );
    expect(rejected).toBeNull();
    expect(skipReasons.get('text:empty')).toBe(1);
  });

  it('clamps sticky and frame geometry/text into AI bounds', () => {
    const stickyText = '   ' + 'Sketch '.repeat(800);
    const stickyOp: BoardOp = {
      type: 'upsertElement',
      element: {
        id: 'sticky-1',
        kind: 'sticky',
        x: -500,
        y: 9999,
        w: 5000,
        h: 9000,
        text: stickyText,
        createdAt: 0,
        createdBy: 'ai',
      },
    };

    const stickyResult = clampSingleBoardOp(stickyOp, new Set(), new Map());
    expect(stickyResult?.op.type).toBe('upsertElement');
    if (stickyResult?.op.type === 'upsertElement' && stickyResult.op.element.kind === 'sticky') {
      const expectedMaxY = Math.max(
        SENSEBOARD_CANVAS_PADDING,
        SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING - SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
      );
      expect(stickyResult.op.element.x).toBe(SENSEBOARD_AI_CONTENT_MIN_X);
      expect(stickyResult.op.element.y).toBe(expectedMaxY);
      expect(stickyResult.op.element.w).toBe(SENSEBOARD_AI_ELEMENT_MAX_WIDTH);
      expect(stickyResult.op.element.h).toBe(SENSEBOARD_AI_ELEMENT_MAX_HEIGHT);
      expect(stickyResult.op.element.text.length).toBe(4000);
      expect(stickyResult.op.element.text.startsWith('   ')).toBe(true);
    }

    const frameTitle = '   Frame Name '.repeat(400);
    const frameOp: BoardOp = {
      type: 'upsertElement',
      element: {
        id: 'frame-1',
        kind: 'frame',
        x: SENSEBOARD_AI_CONTENT_MAX_X + 200,
        y: -200,
        w: 2400,
        h: 50,
        title: frameTitle,
        createdAt: 0,
        createdBy: 'ai',
      },
    };

    const frameResult = clampSingleBoardOp(frameOp, new Set(), new Map());
    expect(frameResult?.op.type).toBe('upsertElement');
    if (frameResult?.op.type === 'upsertElement' && frameResult.op.element.kind === 'frame') {
      const maxFrameX = SENSEBOARD_AI_CONTENT_MAX_X - SENSEBOARD_AI_ELEMENT_MAX_WIDTH;
      expect(frameResult.op.element.x).toBe(maxFrameX);
      expect(frameResult.op.element.y).toBe(SENSEBOARD_CANVAS_PADDING);
      expect(frameResult.op.element.w).toBe(SENSEBOARD_AI_ELEMENT_MAX_WIDTH);
      expect(frameResult.op.element.h >= 1).toBe(true);
      expect(frameResult.op.element.title?.length).toBe(4000);
      expect(frameResult.op.element.title?.startsWith('   ')).toBe(true);
    }
  });

  it('clamps malformed geometry ops and counts batch/invalid skips', () => {
    const clampReasons = new Set<string>();
    const skipReasons = new Map<string, number>();
    const geometryResult = clampSingleBoardOp(
      {
        type: 'setElementGeometry',
        id: 'geo-1',
        x: -999,
        y: 99999,
        w: 0,
        h: 0,
        points: [
          [-100, -100],
          'oops' as unknown as [number, number],
          [SENSEBOARD_CANVAS_WIDTH + 50, 7000],
        ],
      },
      clampReasons,
      skipReasons,
    );

    expect(geometryResult?.op.type).toBe('setElementGeometry');
    if (geometryResult?.op.type === 'setElementGeometry') {
      expect(geometryResult.op.x).toBe(SENSEBOARD_CANVAS_PADDING);
      expect(geometryResult.op.y).toBe(SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING);
      expect(geometryResult.op.w).toBe(1);
      expect(geometryResult.op.h).toBe(1);
      expect(geometryResult.op.points?.length).toBe(2);
      expect(geometryResult.op.points?.[0]).toEqual([
        SENSEBOARD_CANVAS_PADDING,
        SENSEBOARD_CANVAS_PADDING,
      ]);
      expect(geometryResult.op.points?.[1]).toEqual([
        SENSEBOARD_CANVAS_WIDTH - SENSEBOARD_CANVAS_PADDING,
        SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING,
      ]);
    }
    expect(clampReasons.has('geometry:points:invalid_point')).toBe(true);

    const batchSkipReasons = new Map<string, number>();
    const batchResult = clampSingleBoardOp(
      {
        type: 'batch',
        ops: [
          { type: 'setElementText', id: '', text: 'bad' } as BoardOp,
          { type: 'setElementText', id: 'ok', text: ' valid ' },
        ],
      },
      new Set(),
      batchSkipReasons,
    );

    expect(batchResult?.op.type).toBe('batch');
    if (batchResult?.op.type === 'batch') {
      expect(batchResult.op.ops.length).toBe(1);
      expect(batchResult.skippedChildren).toBe(1);
      expect(batchResult.op.ops[0]?.type).toBe('setElementText');
    }
    expect(batchSkipReasons.get('batch:child')).toBe(1);
    expect(batchSkipReasons.get('text:id')).toBe(1);

    const invalidSkipReasons = new Map<string, number>();
    const invalidResult = clampSingleBoardOp(null as unknown as BoardOp, new Set(), invalidSkipReasons);
    expect(invalidResult).toBeNull();
    expect(invalidSkipReasons.get('op:invalid')).toBe(1);
  });
});

describe('guardBoardOpsEnvelope', () => {
  beforeEach(() => {
    resetTranscriptBurstHistory();
  });

  it('applies deterministic fallback when sanitized ops list is empty', () => {
    const envelope = baseEnvelope([
      { type: 'setElementText', id: '', text: '' } as BoardOp,
    ]);
    const result = runGuard(envelope);

    expect(result.fallbackApplied).toBe(true);
    expect(result.telemetry.fallbackReason).toBe('invalid_ops');
    expect(result.telemetry.skipReasons['text:id']).toBe(1);
    expect(result.telemetry.clampReasons).toContain('fallback:invalid_ops');
    expect(result.ops.length).toBeGreaterThan(0);
  });

  it('sanitizes nested ops and reports clamp + skip counts', () => {
    const nested = baseEnvelope([
      null as unknown as BoardOp,
      {
        type: 'batch',
        ops: [
          { type: 'setElementText', id: '', text: 'bad' } as BoardOp,
          {
            type: 'setElementGeometry',
            id: 'shape-1',
            x: -5000,
            y: 7000,
            w: 0.5,
            h: 0.5,
            points: [
              [-10, -10],
              [SENSEBOARD_CANVAS_WIDTH + 10, SENSEBOARD_CANVAS_HEIGHT + 10],
              'oops' as unknown as [number, number],
            ],
          },
        ],
      } as BoardOp,
      { type: 'setElementText', id: 'text-1', text: '  ok ' },
    ]);

    const result = runGuard(nested);
    expect(result.fallbackApplied).toBe(false);
    expect(result.ops.length).toBe(2);

    const [batchOp, textOp] = result.ops;
    expect(batchOp.type).toBe('batch');
    if (batchOp.type === 'batch') {
      expect(batchOp.ops.length).toBe(1);
      const geometry = batchOp.ops[0];
      expect(geometry.type).toBe('setElementGeometry');
      if (geometry.type === 'setElementGeometry') {
        expect(geometry.x).toBe(SENSEBOARD_CANVAS_PADDING);
        expect(geometry.y).toBe(SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING);
        expect(geometry.points?.length).toBe(2);
      }
    }

    expect(textOp.type).toBe('setElementText');
    if (textOp.type === 'setElementText') {
      expect(textOp.text).toBe('ok');
    }

    expect(result.telemetry.clampedOps).toBeGreaterThan(0);
    expect(result.telemetry.skippedOps).toBeGreaterThan(0);
    expect(result.telemetry.skipReasons['op:invalid']).toBe(1);
    expect(result.telemetry.skipReasons['batch:child']).toBe(1);
    expect(result.telemetry.skipReasons['text:id']).toBe(1);
  });

  it('triggers transcript burst fallback and resets after valid payloads', () => {
    const emptyEnvelope = baseEnvelope([]);

    const first = runGuard(emptyEnvelope, { burstKey: 'burst-test', now: 1000 });
    expect(first.telemetry.fallbackReason).toBe('empty_payload');
    expect(first.telemetry.burstCount).toBe(1);

    const second = runGuard(emptyEnvelope, { burstKey: 'burst-test', now: 1500 });
    expect(second.telemetry.fallbackReason).toBe('empty_payload');
    expect(second.telemetry.burstCount).toBe(2);

    const third = runGuard(emptyEnvelope, { burstKey: 'burst-test', now: 1800 });
    expect(third.telemetry.fallbackReason).toBe('transcript_burst');
    expect(third.telemetry.burstCount).toBe(3);

    const recoveryEnvelope = baseEnvelope([
      { type: 'setElementText', id: 'text-3', text: '  hydrated ' },
    ]);
    const recovery = runGuard(recoveryEnvelope, { burstKey: 'burst-test', now: 2500 });
    expect(recovery.fallbackApplied).toBe(false);
    expect(recovery.telemetry.burstCount).toBe(0);
    expect(recovery.ops[0]?.type).toBe('setElementText');
  });
});
