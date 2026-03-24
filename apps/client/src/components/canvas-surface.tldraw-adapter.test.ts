/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import type { BoardElement, BoardState, BoardTextElement } from '../../../shared/types';
import { TranscriptWindowShapeBatcher } from './canvas-surface.tldraw-adapter';

const createTestBoardState = (elements: BoardElement[]): BoardState => {
  return {
    elements: elements.reduce<Record<string, BoardElement>>((acc, element) => {
      acc[element.id] = element;
      return acc;
    }, {}),
    order: elements.map((element) => element.id),
    revision: 1,
    lastUpdatedAt: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
};

let textElementCounter = 0;

const createTextElement = (overrides?: Partial<BoardTextElement>): BoardTextElement => {
  const fallbackId = `text-${textElementCounter++}`;
  return {
    id: overrides?.id ?? fallbackId,
    kind: 'text',
    x: overrides?.x ?? 0,
    y: overrides?.y ?? 0,
    text: overrides?.text ?? 'Sample',
    createdAt: overrides?.createdAt ?? Date.now(),
    createdBy: overrides?.createdBy ?? 'ai',
    ...overrides,
  };
};

describe('TranscriptWindowShapeBatcher', () => {
  it('emits creations, skips identical batches, and isolates snapshots per window', () => {
    const base = Date.now();
    const element = createTextElement({ id: 'text-main', text: 'Initial copy', createdAt: base });
    const batcher = new TranscriptWindowShapeBatcher();

    const first = batcher.process({ transcriptWindowId: 'window-a', board: createTestBoardState([element]), showAiNotes: true });
    expect(first.kind).toBe('diff');
    if (first.kind === 'diff') {
      expect(first.created).toHaveLength(1);
      expect(first.updated).toHaveLength(0);
      expect(first.deleted).toHaveLength(0);
    }

    const duplicate = batcher.process({ transcriptWindowId: 'window-a', board: createTestBoardState([element]), showAiNotes: true });
    expect(duplicate.kind).toBe('skipped');
    if (duplicate.kind === 'skipped') {
      expect(duplicate.reason).toBe('noop');
    }

    const otherWindow = batcher.process({ transcriptWindowId: 'window-b', board: createTestBoardState([element]), showAiNotes: true });
    expect(otherWindow.kind).toBe('diff');
    if (otherWindow.kind === 'diff') {
      expect(otherWindow.created).toHaveLength(1);
    }
  });

  it('emits updates and deletions when shapes change or are removed', () => {
    const batcher = new TranscriptWindowShapeBatcher();
    const element = createTextElement({ id: 'text-main', text: 'Initial' });

    const first = batcher.process({ transcriptWindowId: 'window-a', board: createTestBoardState([element]), showAiNotes: true });
    expect(first.kind).toBe('diff');
    const shapeId = first.kind === 'diff' ? first.created[0]?.id ?? '' : '';
    expect(shapeId).not.toBe('');

    const updatedElement: BoardTextElement = { ...element, text: 'Updated' };
    const updateResult = batcher.process({ transcriptWindowId: 'window-a', board: createTestBoardState([updatedElement]), showAiNotes: true });
    expect(updateResult.kind).toBe('diff');
    if (updateResult.kind === 'diff') {
      expect(updateResult.updated).toHaveLength(1);
      expect(updateResult.updated[0]?.id).toBe(shapeId);
    }

    const deleteResult = batcher.process({ transcriptWindowId: 'window-a', board: createTestBoardState([]), showAiNotes: true });
    expect(deleteResult.kind).toBe('diff');
    if (deleteResult.kind === 'diff') {
      expect(deleteResult.deleted).toContain(shapeId);
      expect(deleteResult.created).toHaveLength(0);
      expect(deleteResult.updated).toHaveLength(0);
    }
  });

  it('skips invalid transcript window identifiers with deterministic messaging', () => {
    const batcher = new TranscriptWindowShapeBatcher();
    const result = batcher.process({ transcriptWindowId: '   ', board: createTestBoardState([]), showAiNotes: true });
    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('invalid_window');
      expect(result.transcriptWindowId).toBe('');
      expect(result.message).toBe('Transcript window id is required before diffing.');
    }
  });

  it('skips invalid shapes and preserves the previous snapshot', () => {
    const batcher = new TranscriptWindowShapeBatcher();
    const element = createTextElement({ id: 'text-main', text: 'Healthy' });

    const initial = batcher.process({ transcriptWindowId: 'window-validation', board: createTestBoardState([element]), showAiNotes: true });
    expect(initial.kind).toBe('diff');
    const shapeId = initial.kind === 'diff' ? initial.created[0]?.id ?? '' : '';
    expect(shapeId).not.toBe('');

    const brokenElement: BoardTextElement = { ...element, x: Number.NaN };
    const invalid = batcher.process({ transcriptWindowId: 'window-validation', board: createTestBoardState([brokenElement]), showAiNotes: true });
    expect(invalid.kind).toBe('skipped');
    if (invalid.kind === 'skipped') {
      expect(invalid.reason).toBe('invalid_shapes');
      expect(invalid.invalidShapeId).toBe(shapeId);
    }

    const updatedElement: BoardTextElement = { ...element, text: 'Changed text' };
    const afterInvalid = batcher.process({ transcriptWindowId: 'window-validation', board: createTestBoardState([updatedElement]), showAiNotes: true });
    expect(afterInvalid.kind).toBe('diff');
    if (afterInvalid.kind === 'diff') {
      expect(afterInvalid.updated).toHaveLength(1);
      expect(afterInvalid.updated[0]?.id).toBe(shapeId);
      expect(afterInvalid.created).toHaveLength(0);
    }
  });

  it('skips noop batches when a window has no shapes yet', () => {
    const batcher = new TranscriptWindowShapeBatcher();
    const result = batcher.process({ transcriptWindowId: 'window-empty', board: createTestBoardState([]), showAiNotes: true });
    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toBe('noop');
      expect(result.message).toBe('No shapes detected for transcript window.');
    }
  });
});
