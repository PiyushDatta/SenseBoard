import { describe, expect, it } from 'bun:test';

import { buildGuardTelemetry } from './telemetry';

describe('buildGuardTelemetry', () => {
  it('sorts clamp/skip reasons and aggregates counts correctly', () => {
    const telemetry = buildGuardTelemetry({
      providerTag: 'provider-a',
      schemaVersion: 2,
      receivedOps: 5,
      forwardedOps: 3,
      skippedTopLevel: 1,
      skippedNested: 2,
      clampedFields: 4,
      clampReasons: new Set(['b', 'a']),
      skipReasons: new Map([
        ['z', 2],
        ['a', 1],
      ]),
      fallbackApplied: false,
      burstCount: 0,
      burstKey: 'default',
      envelopeInvalid: false,
    });

    expect(telemetry.skippedOps).toBe(3);
    expect(telemetry.clampReasons).toEqual(['a', 'b']);
    expect(Object.keys(telemetry.skipReasons)).toEqual(['a', 'z']);
    expect(telemetry.skipReasons.a).toBe(1);
    expect(telemetry.skipReasons.z).toBe(2);
  });
});
