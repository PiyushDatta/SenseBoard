/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { createEmptyBoardState } from '../../../shared/board-state';
import { SENSEBOARD_AI_CONTENT_MAX_X, SENSEBOARD_AI_CONTENT_MIN_X } from '../../../shared/board-dimensions';
import { BOARD_OPS_SCHEMA_VERSION } from '../../../shared/types';
import type { BoardElement, BoardOp, BoardOpsEnvelope, BoardState } from '../../../shared/types';
import { boardToTldrawDraftShapes, guardBoardOpsEnvelope } from './canvas-surface.tldraw-adapter';
import type { BoardOpsGuardOptions } from './canvas-surface.tldraw-adapter';

const withBoard = (elements: BoardElement[], order?: string[]): BoardState => {
  const board = createEmptyBoardState();
  board.order = order ?? elements.map((element) => element.id);
  for (const element of elements) {
    board.elements[element.id] = element;
  }
  return board;
};

const buildGuardEnvelope = (ops: unknown[], overrides?: Partial<BoardOpsEnvelope>): BoardOpsEnvelope =>
  ({
    kind: 'board_ops',
    schemaVersion: overrides?.schemaVersion ?? BOARD_OPS_SCHEMA_VERSION,
    summary: overrides?.summary,
    text: overrides?.text,
    ops: ops as BoardOp[],
  }) as BoardOpsEnvelope;

let burstCounter = 0;
const nextBurstKey = (prefix: string) => `${prefix}-${++burstCounter}`;

describe('canvas-surface tldraw adapter', () => {
  it('maps supported board element kinds to tldraw draft shapes', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'shape-rect',
        kind: 'rect',
        x: 20,
        y: 30,
        w: 140,
        h: 90,
        createdAt: base,
        createdBy: 'ai',
      },
      {
        id: 'shape-ellipse',
        kind: 'ellipse',
        x: 220,
        y: 50,
        w: 120,
        h: 80,
        createdAt: base + 1,
        createdBy: 'ai',
      },
      {
        id: 'shape-diamond',
        kind: 'diamond',
        x: 380,
        y: 60,
        w: 120,
        h: 80,
        createdAt: base + 2,
        createdBy: 'ai',
      },
      {
        id: 'shape-triangle',
        kind: 'triangle',
        x: 540,
        y: 60,
        w: 110,
        h: 90,
        createdAt: base + 3,
        createdBy: 'ai',
      },
      {
        id: 'shape-line',
        kind: 'line',
        points: [
          [80, 200],
          [180, 240],
        ],
        createdAt: base + 4,
        createdBy: 'ai',
      },
      {
        id: 'shape-stroke',
        kind: 'stroke',
        points: [
          [210, 210],
          [240, 260],
          [280, 250],
        ],
        createdAt: base + 5,
        createdBy: 'ai',
      },
      {
        id: 'shape-arrow',
        kind: 'arrow',
        points: [
          [350, 220],
          [460, 290],
        ],
        createdAt: base + 6,
        createdBy: 'ai',
      },
      {
        id: 'shape-sticky',
        kind: 'sticky',
        x: 520,
        y: 250,
        w: 180,
        h: 120,
        text: 'Sticky idea',
        createdAt: base + 7,
        createdBy: 'ai',
      },
      {
        id: 'shape-frame',
        kind: 'frame',
        x: 20,
        y: 360,
        w: 320,
        h: 180,
        title: 'Frame Group',
        createdAt: base + 8,
        createdBy: 'ai',
      },
      {
        id: 'label-main',
        kind: 'text',
        x: 520,
        y: 210,
        text: 'Visible Label',
        createdAt: base + 9,
        createdBy: 'ai',
      },
    ]);

    const drafts = boardToTldrawDraftShapes(board, true);
    expect(drafts.length).toBe(10);
    expect(drafts.some((shape) => shape.kind === 'geo')).toBe(true);
    expect(drafts.some((shape) => shape.kind === 'line')).toBe(true);
    expect(drafts.some((shape) => shape.kind === 'arrow')).toBe(true);
    expect(drafts.some((shape) => shape.kind === 'frame')).toBe(true);
    expect(drafts.some((shape) => shape.kind === 'text')).toBe(true);
  });

  it('hides AI notes/order labels when showAiNotes is disabled', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'notes:group-1',
        kind: 'text',
        x: 40,
        y: 40,
        text: 'AI Notes',
        createdAt: base,
        createdBy: 'ai',
      },
      {
        id: 'order:group-1',
        kind: 'text',
        x: 40,
        y: 70,
        text: 'Order: A -> B',
        createdAt: base + 1,
        createdBy: 'ai',
      },
      {
        id: 'regular:text',
        kind: 'text',
        x: 40,
        y: 100,
        text: 'Manual text',
        createdAt: base + 2,
        createdBy: 'ai',
      },
    ]);

    const hidden = boardToTldrawDraftShapes(board, false);
    const shown = boardToTldrawDraftShapes(board, true);

    expect(hidden.length).toBe(1);
    expect(hidden[0]?.kind).toBe('text');
    expect(hidden[0]?.kind === 'text' ? hidden[0].props.text : '').toBe('Manual text');

    expect(shown.length).toBe(3);
  });

  it('sorts drafts by zIndex before output', () => {
    const base = Date.now();
    const board = withBoard(
      [
        {
          id: 'z-high',
          kind: 'text',
          x: 10,
          y: 30,
          text: 'High Z',
          zIndex: 9,
          createdAt: base + 1,
          createdBy: 'ai',
        },
        {
          id: 'z-low',
          kind: 'text',
          x: 10,
          y: 10,
          text: 'Low Z',
          zIndex: 1,
          createdAt: base,
          createdBy: 'ai',
        },
      ],
      ['z-high', 'z-low'],
    );

    const drafts = boardToTldrawDraftShapes(board, true);
    const labels = drafts
      .filter((shape) => shape.kind === 'text')
      .map((shape) => (shape.kind === 'text' ? shape.props.text : ''));

    expect(labels).toEqual(['Low Z', 'High Z']);
  });

  it('converts line and stroke points to origin-relative point records', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'shape-line',
        kind: 'line',
        points: [
          [100, 200],
          [180, 240],
          [200, 260],
        ],
        createdAt: base,
        createdBy: 'ai',
      },
      {
        id: 'shape-stroke',
        kind: 'stroke',
        points: [
          [300, 400],
          [330, 420],
        ],
        createdAt: base + 1,
        createdBy: 'ai',
      },
    ]);

    const drafts = boardToTldrawDraftShapes(board, true);
    const line = drafts.find((shape) => shape.kind === 'line' && shape.x === 100);
    const stroke = drafts.find((shape) => shape.kind === 'line' && shape.x === 300);

    expect(line?.kind).toBe('line');
    expect(stroke?.kind).toBe('line');

    if (line?.kind === 'line') {
      expect(line.props.points[0]).toEqual({ id: 'p0', index: 'a0', x: 0, y: 0 });
      expect(line.props.points[1]).toEqual({ id: 'p1', index: 'a1', x: 80, y: 40 });
    }

    if (stroke?.kind === 'line') {
      expect(stroke.props.spline).toBe('cubic');
      expect(stroke.props.points[1]).toEqual({ id: 'p1', index: 'a1', x: 30, y: 20 });
    }
  });

  it('wraps and constrains long text labels to avoid horizontal overflow', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'long-label',
        kind: 'text',
        x: 120,
        y: 140,
        text: 'Mapping feature-disclosure outlined a feature flow where items generate achievement plans and mermaid chart outputs for follow-up actions',
        style: { fontSize: 52 },
        createdAt: base,
        createdBy: 'ai',
      },
    ]);

    const drafts = boardToTldrawDraftShapes(board, true);
    const label = drafts.find((shape) => shape.kind === 'text');
    expect(label?.kind).toBe('text');
    if (label?.kind === 'text') {
      expect(label.props.w).toBeLessThanOrEqual(460);
      expect(label.props.size).toBe('l');
      expect(label.props.text.includes('\n')).toBe(true);
    }
  });

  it('wraps sticky text and limits lines by sticky height', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'sticky-long',
        kind: 'sticky',
        x: 80,
        y: 90,
        w: 220,
        h: 110,
        text: 'Blocker: cannot move forward because dependency review and rollout gating are unresolved and need a concrete owner',
        createdAt: base,
        createdBy: 'ai',
      },
    ]);

    const drafts = boardToTldrawDraftShapes(board, true);
    const sticky = drafts.find((shape) => shape.kind === 'geo');
    expect(sticky?.kind).toBe('geo');
    if (sticky?.kind === 'geo') {
      expect(sticky.props.text.length).toBeGreaterThan(0);
      expect(sticky.props.text.includes('\n')).toBe(true);
      const lines = sticky.props.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(5);
    }
  });

  it('constrains free text to containing rectangle bounds', () => {
    const base = Date.now();
    const board = withBoard([
      {
        id: 'container',
        kind: 'rect',
        x: 200,
        y: 300,
        w: 320,
        h: 120,
        createdAt: base,
        createdBy: 'ai',
      },
      {
        id: 'contained-text',
        kind: 'text',
        x: 230,
        y: 325,
        text: 'This text should stay inside the rectangle and should be truncated if it becomes too long for the available height.',
        createdAt: base + 1,
        createdBy: 'ai',
      },
    ]);

    const drafts = boardToTldrawDraftShapes(board, true);
    const text = drafts.find((shape) => shape.kind === 'text');
    expect(text?.kind).toBe('text');
    if (text?.kind === 'text') {
      expect(text.props.w).toBeLessThanOrEqual(320);
      expect(text.x).toBeGreaterThanOrEqual(210);
      expect(text.y).toBeGreaterThanOrEqual(310);
      const lines = text.props.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('board ops guard', () => {
  it('keeps AI-created ops inside the AI lane while preserving system provenance', () => {
    const aiLine = {
      type: 'upsertElement',
      element: {
        id: 'ai-line',
        kind: 'line',
        points: [
          [SENSEBOARD_AI_CONTENT_MIN_X - 200, 120],
          [SENSEBOARD_AI_CONTENT_MAX_X + 600, 340],
        ],
        createdAt: 0,
        createdBy: 'ai',
      },
    } as BoardOp;
    const systemLine = {
      type: 'upsertElement',
      element: {
        id: 'sys-line',
        kind: 'line',
        points: [
          [SENSEBOARD_AI_CONTENT_MAX_X + 500, 200],
          [SENSEBOARD_AI_CONTENT_MAX_X + 650, 320],
        ],
        createdAt: 1,
        createdBy: 'system',
      },
    } as BoardOp;
    const result = guardBoardOpsEnvelope(buildGuardEnvelope([aiLine, systemLine]), {
      providerTag: 'test-provider',
      burstKey: nextBurstKey('lane'),
      now: 1700,
    });
    expect(result.ops).toHaveLength(2);
    const first = result.ops[0];
    const second = result.ops[1];
    expect(first?.type).toBe('upsertElement');
    expect(second?.type).toBe('upsertElement');
    if (first?.type !== 'upsertElement' || second?.type !== 'upsertElement') {
      return;
    }
    const aiPoints = first.element.kind === 'line' ? first.element.points : [];
    expect(first.element.createdBy).toBe('ai');
    aiPoints.forEach(([x]) => {
      expect(x).toBeGreaterThanOrEqual(SENSEBOARD_AI_CONTENT_MIN_X);
      expect(x).toBeLessThanOrEqual(SENSEBOARD_AI_CONTENT_MAX_X);
    });
    expect(second.element.createdBy).toBe('system');
    if (second.element.kind === 'line') {
      expect(second.element.points[0]?.[0]).toBeGreaterThan(SENSEBOARD_AI_CONTENT_MAX_X);
    }
    expect(result.telemetry.clampReasons).toContain('upsert:line_points:x');
    expect(result.telemetry.clampReasons).not.toContain('upsert:created_by');
  });

  it('reports invalid envelope metadata', () => {
    const missing = guardBoardOpsEnvelope(null, { burstKey: nextBurstKey('meta'), now: 10 });
    expect(missing.telemetry.skipReasons['envelope:missing']).toBe(1);

    const badKind = guardBoardOpsEnvelope(
      {
        kind: 'not-board-ops',
        schemaVersion: 0,
        ops: [],
      } as unknown as BoardOpsEnvelope,
      { burstKey: nextBurstKey('meta'), now: 20 },
    );
    expect(badKind.telemetry.skipReasons['envelope:kind']).toBe(1);

    const badOps = guardBoardOpsEnvelope(
      {
        kind: 'board_ops',
        schemaVersion: 0,
        ops: 'oops' as unknown as BoardOp[],
      } as BoardOpsEnvelope,
      { burstKey: nextBurstKey('meta'), now: 30 },
    );
    expect(badOps.telemetry.skipReasons['envelope:ops']).toBe(1);
  });

  it('tracks every skip reason bucket', () => {
    const skipCases: Array<{ reason: string; envelope: BoardOpsEnvelope }> = [
      { reason: 'op:invalid', envelope: buildGuardEnvelope([null as unknown as BoardOp]) },
      {
        reason: 'upsert:invalid_element',
        envelope: buildGuardEnvelope([
          {
            type: 'upsertElement',
            element: {
              id: '',
              kind: 'text',
              x: 10,
              y: 10,
              text: 'invalid',
              createdAt: 0,
              createdBy: 'ai',
            },
          } as BoardOp,
        ]),
      },
      {
        reason: 'append:id',
        envelope: buildGuardEnvelope([{ type: 'appendStrokePoints', id: '', points: [[0, 0]] } as BoardOp]),
      },
      {
        reason: 'append:points_empty',
        envelope: buildGuardEnvelope([{ type: 'appendStrokePoints', id: 'stroke-empty', points: [] }]),
      },
      {
        reason: 'geometry:id',
        envelope: buildGuardEnvelope([{ type: 'setElementGeometry', id: '', x: 1 } as BoardOp]),
      },
      {
        reason: 'geometry:points_invalid',
        envelope: buildGuardEnvelope([
          { type: 'setElementGeometry', id: 'geom-points', points: [['lonely']] } as unknown as BoardOp,
        ]),
      },
      {
        reason: 'geometry:empty',
        envelope: buildGuardEnvelope([{ type: 'setElementGeometry', id: 'geom-empty' } as BoardOp]),
      },
      {
        reason: 'offset:id',
        envelope: buildGuardEnvelope([{ type: 'offsetElement', id: '', dx: 1, dy: 1 } as BoardOp]),
      },
      {
        reason: 'offset:zero_delta',
        envelope: buildGuardEnvelope([{ type: 'offsetElement', id: 'shape', dx: 0, dy: 0 }]),
      },
      {
        reason: 'text:id',
        envelope: buildGuardEnvelope([{ type: 'setElementText', id: '', text: 'valid' } as BoardOp]),
      },
      {
        reason: 'text:empty',
        envelope: buildGuardEnvelope([{ type: 'setElementText', id: 'text-empty', text: '   ' }]),
      },
      {
        reason: 'style:id',
        envelope: buildGuardEnvelope([{ type: 'setElementStyle', id: '', style: {} } as BoardOp]),
      },
      {
        reason: 'style:empty',
        envelope: buildGuardEnvelope([
          { type: 'setElementStyle', id: 'style-empty', style: { strokeWidth: 'wide' as unknown as number } },
        ]),
      },
      {
        reason: 'delete:id',
        envelope: buildGuardEnvelope([{ type: 'deleteElement', id: '' } as BoardOp]),
      },
      {
        reason: 'duplicate:id',
        envelope: buildGuardEnvelope([{ type: 'duplicateElement', id: '', newId: '' } as BoardOp]),
      },
      {
        reason: 'zindex:invalid',
        envelope: buildGuardEnvelope([{ type: 'setElementZIndex', id: 'z', zIndex: Number.NaN } as BoardOp]),
      },
      {
        reason: 'align:ids',
        envelope: buildGuardEnvelope([{ type: 'alignElements', ids: ['solo'], axis: 'left' } as BoardOp]),
      },
      {
        reason: 'distribute:ids',
        envelope: buildGuardEnvelope([{ type: 'distributeElements', ids: ['solo'], axis: 'horizontal' } as BoardOp]),
      },
      {
        reason: 'viewport:empty',
        envelope: buildGuardEnvelope([{ type: 'setViewport', viewport: {} } as BoardOp]),
      },
      {
        reason: 'batch:invalid',
        envelope: buildGuardEnvelope([{ type: 'batch', ops: 'nope' as unknown as BoardOp[] } as BoardOp]),
      },
      {
        reason: 'batch:child',
        envelope: buildGuardEnvelope([
          { type: 'batch', ops: [{ type: 'deleteElement', id: '' } as BoardOp] } as BoardOp,
        ]),
      },
      {
        reason: 'batch:empty',
        envelope: buildGuardEnvelope([{ type: 'batch', ops: [] } as BoardOp]),
      },
    ];

    skipCases.forEach((testCase, index) => {
      const result = guardBoardOpsEnvelope(testCase.envelope, {
        burstKey: nextBurstKey('skip'),
        now: 2000 + index,
      });
      expect(result.telemetry.skipReasons[testCase.reason] ?? 0).toBeGreaterThan(0);
    });
  });

  it('captures clamp reasons across operations', () => {
    const clampOps: unknown[] = [
      {
        type: 'upsertElement',
        element: {
          id: 'text-bound',
          kind: 'text',
          x: -200,
          y: 99999,
          text: 'Line with carriage\rreturn',
          createdAt: 0,
          createdBy: 'robot',
          zIndex: 200000,
          style: { strokeWidth: 999, fontSize: 999 },
        },
      },
      {
        type: 'upsertElement',
        element: {
          id: 'sticky-long',
          kind: 'sticky',
          x: 80,
          y: 40,
          w: 200,
          h: 200,
          text: 's'.repeat(5000),
          createdAt: 1,
          createdBy: 'ai',
        },
      },
      {
        type: 'upsertElement',
        element: {
          id: 'text-empty',
          kind: 'text',
          x: 44,
          y: 44,
          text: ' ',
          createdAt: 2,
          createdBy: 'ai',
        },
      },
      {
        type: 'upsertElement',
        element: {
          id: 'line-short',
          kind: 'line',
          points: [[60, 60]],
          createdAt: 3,
          createdBy: 'ai',
        },
      },
      {
        type: 'appendStrokePoints',
        id: 'stroke-1',
        points: [
          [Number.NaN, Number.NaN],
          ['lonely'] as unknown as [number, number],
        ],
      },
      {
        type: 'setElementGeometry',
        id: 'geom-1',
        x: -60,
        y: 12000,
        w: 32000,
        h: 32000,
        points: [
          [Number.NaN, 40],
          [40, Number.NaN],
          ['bad'] as unknown as [number, number],
        ],
      },
      { type: 'offsetElement', id: 'shape-1', dx: 40000, dy: -40000 },
      { type: 'duplicateElement', id: 'shape-1', newId: 'shape-2', dx: 50000, dy: -60000 },
      { type: 'setElementZIndex', id: 'shape-1', zIndex: 999999 },
      { type: 'alignElements', ids: ['a', 'b'], axis: 'diagonal' as 'left' },
      {
        type: 'distributeElements',
        ids: ['a', 'b'],
        axis: 'slanted' as 'horizontal',
        gap: 90000,
      },
      {
        type: 'setViewport',
        viewport: { x: -250, y: 99000, zoom: 90 },
      },
      { type: 'setElementText', id: 'text-set', text: 'Normalized\r\ntext' },
      { type: 'clearBoard' },
    ];

    const result = guardBoardOpsEnvelope(
      buildGuardEnvelope(clampOps, { schemaVersion: BOARD_OPS_SCHEMA_VERSION + 5 }),
      { burstKey: nextBurstKey('clamp'), now: 3000 },
    );

    const expectedReasons = [
      'schema:version',
      'upsert:created_by',
      'upsert:style',
      'upsert:zindex',
      'upsert:text_sanitized',
      'upsert:text_x',
      'upsert:text_y',
      'upsert:text_empty',
      'upsert:sticky_text',
      'upsert:line_insufficient_points',
      'append:points:x',
      'append:points:y',
      'append:points:invalid_point',
      'geometry:w',
      'geometry:h',
      'geometry:x',
      'geometry:y',
      'geometry:points:x',
      'geometry:points:y',
      'geometry:points:invalid_point',
      'offset:dx',
      'offset:dy',
      'duplicate:dx',
      'duplicate:dy',
      'zindex:clamped',
      'align:axis',
      'distribute:axis',
      'distribute:gap',
      'viewport:x',
      'viewport:y',
      'viewport:zoom',
      'text:sanitized',
    ];

    expectedReasons.forEach((reason) => {
      expect(result.telemetry.clampReasons).toContain(reason);
    });
  });

  it('applies deterministic fallback after repeated invalid payloads and resets after TTL and valid ops', () => {
    const burstKey = nextBurstKey('burst');
    const options: BoardOpsGuardOptions = {
      burstKey,
      burstThreshold: 2,
      burstWindowMs: 500,
    };
    const invalidEnvelope = buildGuardEnvelope([{ type: 'setElementText', id: 'burst', text: ' ' }]);

    const first = guardBoardOpsEnvelope(invalidEnvelope, { ...options, now: 0 });
    expect(first.fallbackApplied).toBe(false);

    const second = guardBoardOpsEnvelope(invalidEnvelope, { ...options, now: 400 });
    expect(second.fallbackApplied).toBe(true);
    expect(second.telemetry.clampReasons).toContain('fallback:transcript_burst');

    const afterTtl = guardBoardOpsEnvelope(invalidEnvelope, { ...options, now: 3600 });
    expect(afterTtl.fallbackApplied).toBe(false);

    const recovery = guardBoardOpsEnvelope(buildGuardEnvelope([{ type: 'clearBoard' }]), {
      ...options,
      now: 3700,
    });
    expect(recovery.fallbackApplied).toBe(false);

    const nextInvalid = guardBoardOpsEnvelope(invalidEnvelope, { ...options, now: 3800 });
    expect(nextInvalid.fallbackApplied).toBe(false);
  });
});
