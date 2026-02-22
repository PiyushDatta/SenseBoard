/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { createEmptyBoardState } from '../../../shared/board-state';
import type { BoardElement, BoardState } from '../../../shared/types';
import { boardToTldrawDraftShapes } from './canvas-surface.tldraw-adapter';

const withBoard = (elements: BoardElement[], order?: string[]): BoardState => {
  const board = createEmptyBoardState();
  board.order = order ?? elements.map((element) => element.id);
  for (const element of elements) {
    board.elements[element.id] = element;
  }
  return board;
};

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
});
