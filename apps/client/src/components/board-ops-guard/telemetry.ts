export interface BoardOpsGuardTelemetry {
  providerTag: string;
  schemaVersion: number;
  receivedOps: number;
  forwardedOps: number;
  skippedOps: number;
  skippedTopLevelOps: number;
  skippedNestedOps: number;
  clampedOps: number;
  clampReasons: string[];
  skipReasons: Record<string, number>;
  fallbackApplied: boolean;
  burstCount: number;
  burstKey: string;
  envelopeInvalid: boolean;
}

export interface GuardTelemetryParams {
  providerTag: string;
  schemaVersion: number;
  receivedOps: number;
  forwardedOps: number;
  skippedTopLevel: number;
  skippedNested: number;
  clampedFields: number;
  clampReasons: Set<string>;
  skipReasons: Map<string, number>;
  fallbackApplied: boolean;
  burstCount: number;
  burstKey: string;
  envelopeInvalid: boolean;
}

export const buildGuardTelemetry = (params: GuardTelemetryParams): BoardOpsGuardTelemetry => {
  const skipReasonsRecord = Object.fromEntries(
    Array.from(params.skipReasons.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    providerTag: params.providerTag,
    schemaVersion: params.schemaVersion,
    receivedOps: params.receivedOps,
    forwardedOps: params.forwardedOps,
    skippedOps: params.skippedTopLevel + params.skippedNested,
    skippedTopLevelOps: params.skippedTopLevel,
    skippedNestedOps: params.skippedNested,
    clampedOps: params.clampedFields,
    clampReasons: Array.from(params.clampReasons).sort(),
    skipReasons: skipReasonsRecord,
    fallbackApplied: params.fallbackApplied,
    burstCount: params.burstCount,
    burstKey: params.burstKey,
    envelopeInvalid: params.envelopeInvalid,
  };
};

export const registerSkipReason = (skipReasons: Map<string, number>, reason: string) => {
  skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
};
