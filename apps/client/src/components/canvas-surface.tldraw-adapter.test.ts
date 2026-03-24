import { describe, expect, it } from 'bun:test';

import type { AdapterGuardTelemetryEvent } from './canvas-surface.tldraw-adapter';
import { createIncrementalBoardOpsGuard } from './canvas-surface.tldraw-adapter';
import type { BoardOp, BoardOpsEnvelope, BoardRectElement, BoardState } from '../../../shared/types';
import { BOARD_OPS_SCHEMA_VERSION } from '../../../shared/types';

const buildBoardState = (): BoardState => ({
  elements: {
    box: {
      id: 'box',
      kind: 'rect',
      x: 10,
      y: 10,
      w: 120,
      h: 80,
      createdAt: 1,
      createdBy: 'ai',
    },
  },
  order: ['box'],
  revision: 1,
  lastUpdatedAt: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const buildRectElement = (id: string, overrides?: Partial<BoardRectElement>): BoardRectElement => ({
  id,
  kind: 'rect',
  x: 0,
  y: 0,
  w: 24,
  h: 24,
  createdAt: 11,
  createdBy: 'ai',
  ...(overrides ?? {}),
});

const recordTelemetry = (bucket: AdapterGuardTelemetryEvent[]) => (event: AdapterGuardTelemetryEvent) => {
  bucket.push(event);
};

const makeEnvelope = (ops: BoardOpsEnvelope['ops']): BoardOpsEnvelope => ({
  kind: 'board_ops',
  schemaVersion: BOARD_OPS_SCHEMA_VERSION,
  ops,
});

describe('createIncrementalBoardOpsGuard', () => {
  it('snapshots the provided board before applying new ops and preserves a recoverable clone', () => {
    const guard = createIncrementalBoardOpsGuard();
    const board = buildBoardState();

    const envelope = makeEnvelope([{ type: 'upsertElement', element: buildRectElement('fresh') }]);

    const result = guard.guardIncomingOps(envelope, { boardBefore: board });
    expect(result.ok).toBe(true);
    const recovered = guard.recoverLastAcceptedBoard();
    expect(recovered).not.toBeNull();
    expect(recovered).not.toBe(board);
    expect(recovered).toEqual(board);

    board.elements.box.x = 500;
    const recoveredAfterMutation = guard.recoverLastAcceptedBoard();
    expect(recoveredAfterMutation?.elements.box.x).toBe(10);
  });

  it('filters duplicate IDs before returning accepted ops and reports telemetry', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const board = buildBoardState();
    const envelope = makeEnvelope([
      { type: 'upsertElement', element: buildRectElement('dupe') },
      { type: 'upsertElement', element: buildRectElement('dupe', { w: 48 }) },
      { type: 'duplicateElement', id: 'dupe', newId: 'box' },
    ]);

    const context = { boardBefore: board, provider: 'ai_guard', source: 'unit' };
    const result = guard.guardIncomingOps(envelope, context);
    expect(result.ok).toBe(true);
    expect(result.acceptedOps).toHaveLength(1);
    expect(result.droppedDuplicateCount).toBe(2);
    expect(result.duplicateIds).toEqual(expect.arrayContaining(['dupe', 'box']));
    expect(guard.counters.duplicateRepairs).toBe(2);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'duplicate_id',
          action: 'repair',
          provider: context.provider,
          source: context.source,
          duplicateIds: expect.arrayContaining(['dupe', 'box']),
          droppedOps: 2,
        }),
      ]),
    );
  });

  it('rejects schema mismatches and increments schema counters', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const context = { provider: 'ai_guard', source: 'unit' };
    const mismatchedEnvelope: unknown = {
      kind: 'board_ops',
      schemaVersion: BOARD_OPS_SCHEMA_VERSION + 1,
      ops: [],
    };

    const result = guard.guardIncomingOps(mismatchedEnvelope, context);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('schema_mismatch');
    expect(guard.counters.schemaRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'schema',
          action: 'reject',
          reason: 'schema_mismatch',
          provider: context.provider,
          source: context.source,
          counters: expect.objectContaining({ schemaRejections: 1 }),
        }),
      ]),
    );
  });

  it('rejects invalid ops and preserves the last board snapshot for recovery', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const board = buildBoardState();
    const context = { boardBefore: board, provider: 'ai_guard', source: 'unit' };
    const invalidEnvelope: unknown = {
      kind: 'board_ops',
      schemaVersion: BOARD_OPS_SCHEMA_VERSION,
      ops: [{ type: 'bogus_op' }],
    };

    const result = guard.guardIncomingOps(invalidEnvelope, context);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_ops');
    expect(guard.counters.payloadRejections).toBe(1);
    expect(result.droppedInvalidCount).toBeGreaterThan(0);
    const recovered = guard.recoverLastAcceptedBoard();
    expect(recovered).not.toBeNull();
    expect(recovered).not.toBe(context.boardBefore);
    expect(recovered).toEqual(context.boardBefore);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'payload',
          action: 'reject',
          reason: 'invalid_ops',
          provider: context.provider,
          source: context.source,
        }),
      ]),
    );
  });

  it('repairs malformed ops deterministically', () => {
    const guard = createIncrementalBoardOpsGuard();
    const buildEnvelopeFor = (id: string): BoardOpsEnvelope =>
      makeEnvelope([
        {
          type: 'upsertElement',
          element: { id, kind: 'rect', x: 1, y: 2, w: 3, h: 4 },
        },
      ]);

    const first = guard.guardIncomingOps(buildEnvelopeFor('alpha'));
    const second = guard.guardIncomingOps(buildEnvelopeFor('alpha'));
    const different = guard.guardIncomingOps(buildEnvelopeFor('beta'));

    const firstOp = first.acceptedOps[0];
    const secondOp = second.acceptedOps[0];
    const thirdOp = different.acceptedOps[0];

    if (firstOp?.type !== 'upsertElement' || secondOp?.type !== 'upsertElement' || thirdOp?.type !== 'upsertElement') {
      throw new Error('expected upsertElement ops');
    }

    expect(firstOp.element.createdAt).toBe(secondOp.element.createdAt);
    expect(firstOp.element.createdAt).not.toBe(thirdOp.element.createdAt);
    expect(firstOp.element.createdBy).toBe('ai');
  });

  it('emits structured telemetry with guard reason, provider, and counters', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const context = { provider: 'ai_guard', source: 'unit' };

    const schemaMismatch: unknown = {
      kind: 'board_ops',
      schemaVersion: BOARD_OPS_SCHEMA_VERSION + 1,
      ops: [],
    };
    const malformed: unknown = {
      kind: 'board_ops',
      schemaVersion: BOARD_OPS_SCHEMA_VERSION,
      ops: [{ type: 'bogus_op' }],
    };

    const schemaResult = guard.guardIncomingOps(schemaMismatch, context);
    expect(schemaResult.ok).toBe(false);
    const malformedResult = guard.guardIncomingOps(malformed, context);
    expect(malformedResult.ok).toBe(false);
    expect(guard.counters.payloadRejections).toBe(1);

    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'schema',
          action: 'reject',
          reason: 'schema_mismatch',
          provider: context.provider,
          source: context.source,
          counters: expect.objectContaining({ schemaRejections: 1 }),
        }),
        expect.objectContaining({
          guard: 'payload',
          action: 'reject',
          reason: 'invalid_ops',
          provider: context.provider,
          source: context.source,
          counters: expect.objectContaining({ payloadRejections: 1 }),
        }),
      ]),
    );
  });

  it('rejects bare arrays that omit the schema envelope entirely', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const invalidPayload = [{ type: 'upsertElement', element: buildRectElement('raw') }];

    const result = guard.guardIncomingOps(invalidPayload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_envelope');
    expect(guard.counters.schemaRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'schema', action: 'reject', reason: 'invalid_envelope' }),
      ]),
    );
  });

  it('rejects envelopes that omit the ops array entirely', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const result = guard.guardIncomingOps({ kind: 'board_ops', schemaVersion: BOARD_OPS_SCHEMA_VERSION });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_ops');
    expect(guard.counters.schemaRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'schema', action: 'reject', reason: 'missing_ops' }),
      ]),
    );
  });

  it('rejects envelopes that provide an empty ops array', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const envelope: BoardOpsEnvelope = { kind: 'board_ops', schemaVersion: BOARD_OPS_SCHEMA_VERSION, ops: [] };
    const result = guard.guardIncomingOps(envelope);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty_ops');
    expect(guard.counters.schemaRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'schema', action: 'reject', reason: 'empty_ops' }),
      ]),
    );
  });

  it('rejects batches that exceed the maximum supported depth', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const buildDeepBatch = (depth: number): BoardOp =>
      depth === 0 ? { type: 'clearBoard' } : { type: 'batch', ops: [buildDeepBatch(depth - 1)] };
    const result = guard.guardIncomingOps(makeEnvelope([buildDeepBatch(5)]));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_ops');
    expect(guard.counters.payloadRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'payload', action: 'reject', reason: 'invalid_ops' }),
      ]),
    );
  });

  it('truncates oversized stroke point payloads and emits repair telemetry', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const oversizedPoints = Array.from({ length: 1_000 }, (_, index) => [index, index * 2]);
    const envelope = makeEnvelope([{ type: 'appendStrokePoints', id: 'stroke-1', points: oversizedPoints }]);

    const result = guard.guardIncomingOps(envelope);
    expect(result.ok).toBe(true);
    const op = result.acceptedOps[0];
    if (!op || op.type !== 'appendStrokePoints') {
      throw new Error('expected appendStrokePoints op');
    }
    expect(op.points.length).toBeLessThan(oversizedPoints.length);
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(guard.counters.payloadRepairs).toBeGreaterThan(0);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'payload', action: 'repair', reason: 'points_truncated' }),
      ]),
    );
  });

  it('rejects invalid geometry payloads instead of repairing them', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const result = guard.guardIncomingOps(
      makeEnvelope([{ type: 'setElementGeometry', id: 'box', x: 'bogus', y: 1, w: 2, h: 3 } as any]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_ops');
    expect(guard.counters.payloadRejections).toBe(1);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'payload', action: 'reject', reason: 'invalid_ops' }),
      ]),
    );
  });

  it('rejects invalid style payloads', () => {
    const guard = createIncrementalBoardOpsGuard();
    const result = guard.guardIncomingOps(
      makeEnvelope([{ type: 'setElementStyle', id: 'box', style: { strokeWidth: 'heavy' } as any }]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_ops');
    expect(guard.counters.payloadRejections).toBe(1);
  });

  it('rejects invalid text payloads', () => {
    const guard = createIncrementalBoardOpsGuard();
    const result = guard.guardIncomingOps(
      makeEnvelope([{ type: 'setElementText', id: 'box', text: { bogus: true } as any }]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_ops');
    expect(guard.counters.payloadRejections).toBe(1);
  });

  it('filters duplicate IDs inside nested batches deterministically', () => {
    const telemetryEvents: AdapterGuardTelemetryEvent[] = [];
    const guard = createIncrementalBoardOpsGuard({ emitTelemetry: recordTelemetry(telemetryEvents) });
    const board = buildBoardState();
    const nestedEnvelope = makeEnvelope([
      {
        type: 'batch',
        ops: [
          { type: 'upsertElement', element: buildRectElement('nested') },
          {
            type: 'batch',
            ops: [
              { type: 'upsertElement', element: buildRectElement('nested', { w: 40 }) },
              { type: 'duplicateElement', id: 'nested', newId: 'box' },
            ],
          },
        ],
      },
    ]);

    const context = { boardBefore: board, provider: 'ai_guard', source: 'nested' };
    const result = guard.guardIncomingOps(nestedEnvelope, context);
    expect(result.ok).toBe(true);
    expect(result.droppedDuplicateCount).toBe(3);
    expect(result.duplicateIds).toEqual(expect.arrayContaining(['nested', 'box']));
    expect(guard.counters.duplicateRepairs).toBe(3);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'duplicate_id',
          action: 'repair',
          duplicateIds: expect.arrayContaining(['nested', 'box']),
          droppedOps: 3,
        }),
      ]),
    );
  });
});
