import { describe, expect, it } from 'bun:test';

import {
  clampNumber,
  clampNumericValue,
  clampPointWithinBounds,
  clampStrokePoints,
  type ClampCounter,
  type GuardBounds,
} from './numeric';

describe('numeric guard utilities', () => {
  it('clamps numeric ranges', () => {
    expect(clampNumber(50, 0, 10)).toBe(10);
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it('tracks clamp reasons for invalid numeric inputs', () => {
    const reasons = new Set<string>();
    const counter: ClampCounter = { count: 0 };
    const value = clampNumericValue('bad', 0, 100, 'numeric:test', reasons, counter, 5);
    expect(value).toBe(5);
    expect(reasons.has('numeric:test')).toBe(true);
    expect(counter.count).toBe(1);
  });

  it('clamps points within guard bounds and records invalid axes', () => {
    const bounds: GuardBounds = {
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 50,
      maxWidth: 100,
      maxHeight: 50,
    };
    const reasons = new Set<string>();
    const counter: ClampCounter = { count: 0 };
    const point = clampPointWithinBounds([200, -10], bounds, 'point:test', reasons, counter);
    expect(point).toEqual([100, 0]);
    expect(reasons.has('point:test:x')).toBe(true);
    expect(reasons.has('point:test:y')).toBe(true);
    expect(counter.count).toBe(2);
  });

  it('filters invalid stroke points', () => {
    const bounds: GuardBounds = {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      maxWidth: 10,
      maxHeight: 10,
    };
    const reasons = new Set<string>();
    const counter: ClampCounter = { count: 0 };
    const points = clampStrokePoints(
      [
        [5, 5],
        ['bad'],
        [15, -2],
      ],
      bounds,
      'stroke',
      reasons,
      counter,
    );
    expect(points).toEqual([
      [5, 5],
      [10, 0],
    ]);
    expect(reasons.has('stroke:invalid_point')).toBe(true);
    expect(counter.count).toBeGreaterThanOrEqual(2);
  });
});
