/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { DRAG_THRESHOLD_PX, isDragGesture, shouldToggleOptionsOnPress } from './floating-options.logic';

describe('floating options interaction logic', () => {
  it('treats tiny movement as click, not drag', () => {
    expect(isDragGesture(0, 0)).toBe(false);
    expect(isDragGesture(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(isDragGesture(0, DRAG_THRESHOLD_PX)).toBe(false);
    expect(isDragGesture(DRAG_THRESHOLD_PX - 1, DRAG_THRESHOLD_PX - 1)).toBe(false);
  });

  it('treats movement beyond threshold as drag', () => {
    expect(isDragGesture(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    expect(isDragGesture(0, DRAG_THRESHOLD_PX + 1)).toBe(true);
    expect(isDragGesture(-(DRAG_THRESHOLD_PX + 2), 0)).toBe(true);
  });

  it('toggles options on press only when gesture was not dragged', () => {
    expect(shouldToggleOptionsOnPress(false)).toBe(true);
    expect(shouldToggleOptionsOnPress(true)).toBe(false);
  });
});
