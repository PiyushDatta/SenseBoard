import { describe, expect, it } from 'bun:test';

import { createTranscriptBurstTracker } from './burst-tracker';

describe('transcript burst tracker', () => {
  it('triggers after threshold of invalid payloads and resets on success', () => {
    const tracker = createTranscriptBurstTracker();
    const first = tracker.track('series', true, 0, 2, 500);
    expect(first.triggered).toBe(false);
    const second = tracker.track('series', true, 200, 2, 500);
    expect(second.triggered).toBe(true);
    const reset = tracker.track('series', false, 400, 2, 500);
    expect(reset.burstCount).toBe(0);
    expect(reset.triggered).toBe(false);
  });

  it('drops stale history entries after TTL', () => {
    const tracker = createTranscriptBurstTracker();
    tracker.track('stale', true, 0, 3, 250);
    tracker.track('stale', true, 100, 3, 250);
    tracker.track('stale', true, 200, 3, 250);
    const afterTtl = tracker.track('stale', true, 3000, 3, 250);
    expect(afterTtl.burstCount).toBe(1);
    expect(afterTtl.triggered).toBe(false);
    tracker.reset();
    const afterReset = tracker.track('stale', true, 3200, 3, 250);
    expect(afterReset.burstCount).toBe(1);
  });
});
