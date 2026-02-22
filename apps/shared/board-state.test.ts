/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { applyBoardOp, applyBoardOps, clampBoardToCanvasBoundsInPlace, createEmptyBoardState } from './board-state';
import {
  SENSEBOARD_AI_CONTENT_MAX_X,
  SENSEBOARD_AI_CONTENT_MIN_X,
  SENSEBOARD_AI_ELEMENT_MAX_HEIGHT,
  SENSEBOARD_AI_ELEMENT_MAX_WIDTH,
  SENSEBOARD_CANVAS_HEIGHT,
  SENSEBOARD_CANVAS_PADDING,
  SENSEBOARD_CANVAS_WIDTH,
} from './board-dimensions';
import type { BoardElement } from './types';

const rect = (id: string): BoardElement => ({
  id,
  kind: 'rect',
  x: 100,
  y: 80,
  w: 200,
  h: 120,
  createdAt: 1,
  createdBy: 'ai',
  style: { roughness: 2 },
});

describe('board-state reducer', () => {
  it('applies upsert deterministically', () => {
    const base = createEmptyBoardState();
    const op = { type: 'upsertElement' as const, element: rect('a') };
    const one = applyBoardOp(base, op);
    const two = applyBoardOp(base, op);
    expect({ ...one, lastUpdatedAt: 0 }).toEqual({ ...two, lastUpdatedAt: 0 });
    expect(one.order).toEqual(['a']);
  });

  it('applies batch ops in order', () => {
    const base = createEmptyBoardState();
    const next = applyBoardOps(base, [
      { type: 'upsertElement', element: rect('a') },
      { type: 'upsertElement', element: rect('b') },
      { type: 'deleteElement', id: 'a' },
    ]);
    expect(next.elements.a).toBeUndefined();
    expect(next.elements.b).toBeDefined();
    expect(next.order).toEqual(['b']);
  });

  it('clearBoard removes all elements', () => {
    const withElement = applyBoardOp(createEmptyBoardState(), {
      type: 'upsertElement',
      element: rect('a'),
    });
    const cleared = applyBoardOp(withElement, { type: 'clearBoard' });
    expect(cleared.order.length).toBe(0);
    expect(Object.keys(cleared.elements).length).toBe(0);
  });

  it('clamps oversized/out-of-bounds geometry into canvas bounds', () => {
    const state = createEmptyBoardState();
    const now = Date.now();
    state.elements = {
      'oob-rect': {
        id: 'oob-rect',
        kind: 'rect',
        x: SENSEBOARD_CANVAS_WIDTH - 40,
        y: -200,
        w: 900,
        h: 900,
        createdAt: now,
        createdBy: 'ai',
      },
      'oob-text': {
        id: 'oob-text',
        kind: 'text',
        x: SENSEBOARD_CANVAS_WIDTH + 300,
        y: SENSEBOARD_CANVAS_HEIGHT + 400,
        text: 'out',
        createdAt: now + 1,
        createdBy: 'ai',
      },
      'oob-line': {
        id: 'oob-line',
        kind: 'line',
        points: [
          [-100, 7000],
          [9500, -100],
        ],
        createdAt: now + 2,
        createdBy: 'ai',
      },
    };
    state.order = ['oob-rect', 'oob-text', 'oob-line'];

    const adjusted = clampBoardToCanvasBoundsInPlace(state);
    expect(adjusted).toBeGreaterThan(0);

    const rectElement = state.elements['oob-rect'];
    expect(rectElement && rectElement.kind === 'rect' && rectElement.x).toBeGreaterThanOrEqual(SENSEBOARD_AI_CONTENT_MIN_X);
    expect(rectElement && rectElement.kind === 'rect' && rectElement.y).toBeGreaterThanOrEqual(SENSEBOARD_CANVAS_PADDING);
    expect(rectElement && rectElement.kind === 'rect' && rectElement.w).toBeLessThanOrEqual(SENSEBOARD_AI_ELEMENT_MAX_WIDTH);
    expect(rectElement && rectElement.kind === 'rect' && rectElement.h).toBeLessThanOrEqual(SENSEBOARD_AI_ELEMENT_MAX_HEIGHT);
    expect(rectElement && rectElement.kind === 'rect' && rectElement.x + rectElement.w).toBeLessThanOrEqual(SENSEBOARD_AI_CONTENT_MAX_X);
    expect(rectElement && rectElement.kind === 'rect' && rectElement.y + rectElement.h).toBeLessThanOrEqual(
      SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING,
    );

    const textElement = state.elements['oob-text'];
    expect(textElement && textElement.kind === 'text' && textElement.x).toBeGreaterThanOrEqual(SENSEBOARD_AI_CONTENT_MIN_X);
    expect(textElement && textElement.kind === 'text' && textElement.x).toBeLessThanOrEqual(SENSEBOARD_AI_CONTENT_MAX_X);
    expect(textElement && textElement.kind === 'text' && textElement.y).toBeLessThanOrEqual(
      SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING,
    );

    const lineElement = state.elements['oob-line'];
    if (lineElement && lineElement.kind === 'line') {
      lineElement.points.forEach(([x, y]) => {
        expect(x).toBeGreaterThanOrEqual(SENSEBOARD_AI_CONTENT_MIN_X);
        expect(x).toBeLessThanOrEqual(SENSEBOARD_AI_CONTENT_MAX_X);
        expect(y).toBeGreaterThanOrEqual(SENSEBOARD_CANVAS_PADDING);
        expect(y).toBeLessThanOrEqual(SENSEBOARD_CANVAS_HEIGHT - SENSEBOARD_CANVAS_PADDING);
      });
    } else {
      expect(lineElement).toBeDefined();
    }
  });
});
