import { describe, expect, it } from 'bun:test';

import type { BoardElement, BoardOp } from '../../../../shared/types';
import { clampBoardElementForOps, clampSingleBoardOp } from './op-clamp';

describe('op clamp helpers', () => {
  it('clamps AI elements within bounds and uses injected clock for createdAt', () => {
    const element: BoardElement = {
      id: 'text-ai',
      kind: 'text',
      x: -50,
      y: 9000,
      text: '  ',
      createdAt: Number.NaN,
      createdBy: 'ai',
    };
    const reasons = new Set<string>();
    const result = clampBoardElementForOps(element, reasons, 1700);
    if (!result) {
      throw new Error('expected element clamp result');
    }
    expect(result.element.x).toBeGreaterThanOrEqual(0);
    expect(result.element.y).toBeGreaterThanOrEqual(0);
    expect(result.element.text).toBe('');
    expect(result.element.createdAt).toBe(1700);
    expect(Array.from(reasons)).toContain('upsert:text:empty');
  });

  it('allows setElementText ops to clear text while recording clamp reasons', () => {
    const reasons = new Set<string>();
    const skipReasons = new Map<string, number>();
    const op: BoardOp = { type: 'setElementText', id: 'note', text: '   ' } as BoardOp;
    const result = clampSingleBoardOp(op, reasons, skipReasons, 1000);
    if (!result || result.op.type !== 'setElementText') {
      throw new Error('expected sanitized setElementText result');
    }
    expect(result.op.text).toBe('');
    expect(reasons.has('text:empty')).toBe(true);
    expect(skipReasons.size).toBe(0);
  });

  it('skips setElementText ops with non-string payloads', () => {
    const reasons = new Set<string>();
    const skipReasons = new Map<string, number>();
    const op = { type: 'setElementText', id: 'note', text: 42 } as BoardOp;
    const result = clampSingleBoardOp(op, reasons, skipReasons, 2000);
    expect(result).toBeNull();
    expect(skipReasons.get('text:invalid')).toBe(1);
  });
});
