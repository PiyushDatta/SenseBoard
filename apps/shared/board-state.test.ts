/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { applyBoardOp, applyBoardOps, createEmptyBoardState } from './board-state';
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
});
