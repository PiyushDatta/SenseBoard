/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createEmptyBoardState } from '../../../shared/board-state';
import { createEmptyRoom } from '../../../shared/room-state';
import type { BoardElement, RoomState } from '../../../shared/types';
import { THEMES } from '../lib/theme';
import { CanvasSurface } from './canvas-surface.web';

const withBoard = (elements: BoardElement[], order?: string[]): RoomState => {
  const room = createEmptyRoom('ROOM-CANVAS');
  room.board = createEmptyBoardState();
  const nextOrder = order ?? elements.map((element) => element.id);
  room.board.order = nextOrder;
  for (const element of elements) {
    room.board.elements[element.id] = element;
  }
  return room;
};

const render = (room: RoomState, showAiNotes = true) =>
  renderToStaticMarkup(
    React.createElement(CanvasSurface, {
      room,
      focusDrawMode: false,
      onFocusBoxSelected: () => {},
      onFocusDrawModeChange: () => {},
      showAiNotes,
      theme: THEMES.light,
    }),
  );

describe('canvas-surface.web', () => {
  it('renders a board container and svg even when room has no elements', () => {
    const room = createEmptyRoom('ROOM-CANVAS-EMPTY');
    const html = render(room);
    expect(html).toContain('<svg');
    expect(html).toContain('cursor:grab');
  });

  it('renders all supported element kinds on the SVG board', () => {
    const base = Date.now();
    const room = withBoard([
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

    const html = render(room, true);
    expect(html).toContain('<ellipse');
    expect(html).toContain('Visible Label');
    expect(html).toContain('Sticky idea');
    expect(html).toContain('Frame Group');
    expect(html.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('hides AI notes/order text when showAiNotes is disabled', () => {
    const base = Date.now();
    const room = withBoard([
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

    const hiddenHtml = render(room, false);
    expect(hiddenHtml).not.toContain('AI Notes');
    expect(hiddenHtml).not.toContain('Order: A -&gt; B');
    expect(hiddenHtml).toContain('Manual text');

    const shownHtml = render(room, true);
    expect(shownHtml).toContain('AI Notes');
    expect(shownHtml).toContain('Order: A -&gt; B');
  });

  it('orders rendered elements by zIndex (ascending)', () => {
    const base = Date.now();
    const low: BoardElement = {
      id: 'z-low',
      kind: 'text',
      x: 10,
      y: 10,
      text: 'Low Z',
      zIndex: 1,
      createdAt: base,
      createdBy: 'ai',
    };
    const high: BoardElement = {
      id: 'z-high',
      kind: 'text',
      x: 10,
      y: 30,
      text: 'High Z',
      zIndex: 9,
      createdAt: base + 1,
      createdBy: 'ai',
    };
    const room = withBoard([high, low], [high.id, low.id]);
    const html = render(room, true);
    expect(html.indexOf('Low Z')).toBeLessThan(html.indexOf('High Z'));
  });
});
