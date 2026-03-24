import { BURST_HISTORY_TTL_MULTIPLIER, MAX_BURST_HISTORY_ENTRIES } from './constants';

interface BurstHistoryEntry {
  count: number;
  lastTimestamp: number;
}

export interface TrackBurstResult {
  burstCount: number;
  triggered: boolean;
}

export interface TranscriptBurstTracker {
  track: (
    key: string,
    invalidPayload: boolean,
    now: number,
    threshold: number,
    windowMs: number,
  ) => TrackBurstResult;
  reset: () => void;
}

const pruneHistory = (history: Map<string, BurstHistoryEntry>, now: number, windowMs: number) => {
  const ttl = Math.max(500, windowMs);
  const expiredBefore = now - ttl * BURST_HISTORY_TTL_MULTIPLIER;
  for (const [key, entry] of history.entries()) {
    if (entry.lastTimestamp < expiredBefore) {
      history.delete(key);
    }
  }
  if (history.size <= MAX_BURST_HISTORY_ENTRIES) {
    return;
  }
  const ordered = Array.from(history.entries()).sort((left, right) => left[1].lastTimestamp - right[1].lastTimestamp);
  while (history.size > MAX_BURST_HISTORY_ENTRIES && ordered.length > 0) {
    const next = ordered.shift();
    if (next) {
      history.delete(next[0]);
    }
  }
};

export const createTranscriptBurstTracker = (): TranscriptBurstTracker => {
  const history = new Map<string, BurstHistoryEntry>();
  return {
    track: (key, invalidPayload, now, threshold, windowMs) => {
      pruneHistory(history, now, windowMs);
      if (!invalidPayload) {
        history.set(key, { count: 0, lastTimestamp: now });
        return { burstCount: 0, triggered: false };
      }
      const previous = history.get(key);
      const withinWindow = previous && now - previous.lastTimestamp <= windowMs;
      const nextCount = withinWindow ? (previous?.count ?? 0) + 1 : 1;
      history.set(key, { count: nextCount, lastTimestamp: now });
      return {
        burstCount: nextCount,
        triggered: nextCount >= threshold,
      };
    },
    reset: () => {
      history.clear();
    },
  };
};

export const defaultBurstTracker = createTranscriptBurstTracker();
