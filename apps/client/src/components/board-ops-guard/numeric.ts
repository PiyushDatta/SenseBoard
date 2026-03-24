import type { BoardPoint } from '../../../../shared/types';

export interface GuardBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxWidth: number;
  maxHeight: number;
}

export interface ClampCounter {
  count: number;
}

export const clampNumber = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const clampNumericValue = (
  value: unknown,
  min: number,
  max: number,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
  fallback?: number,
): number => {
  const numeric = isFiniteNumber(value) ? value : fallback ?? min;
  const clamped = clampNumber(numeric, min, max);
  if (clamped !== numeric || numeric !== value) {
    clampReasons.add(reason);
    counter.count += 1;
  }
  return clamped;
};

export const clampPointWithinBounds = (
  point: unknown,
  bounds: GuardBounds,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
): BoardPoint | null => {
  if (!Array.isArray(point) || point.length < 2) {
    clampReasons.add(`${reason}:invalid_point`);
    counter.count += 1;
    return null;
  }
  const [xRaw, yRaw] = point;
  const xNumeric = isFiniteNumber(xRaw) ? xRaw : bounds.minX;
  const yNumeric = isFiniteNumber(yRaw) ? yRaw : bounds.minY;
  const x = clampNumber(xNumeric, bounds.minX, bounds.maxX);
  const y = clampNumber(yNumeric, bounds.minY, bounds.maxY);
  if (x !== xNumeric || xNumeric !== xRaw) {
    clampReasons.add(`${reason}:x`);
    counter.count += 1;
  }
  if (y !== yNumeric || yNumeric !== yRaw) {
    clampReasons.add(`${reason}:y`);
    counter.count += 1;
  }
  return [x, y];
};

export const clampStrokePoints = (
  points: unknown,
  bounds: GuardBounds,
  reason: string,
  clampReasons: Set<string>,
  counter: ClampCounter,
): BoardPoint[] => {
  if (!Array.isArray(points)) {
    return [];
  }
  const sanitized: BoardPoint[] = [];
  for (const entry of points) {
    const clamped = clampPointWithinBounds(entry, bounds, reason, clampReasons, counter);
    if (clamped) {
      sanitized.push(clamped);
    }
  }
  return sanitized;
};
