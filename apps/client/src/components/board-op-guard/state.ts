import type { GuardReasonRecord } from './sanitizers';

export interface BoardOpGuardTelemetryEvent {
  kind: 'board_op_guard';
  scopeKey: string;
  providerTag: string;
  totalOps: number;
  sanitizedOps: number;
  droppedOps: number;
  clampedOps: number;
  fallbackOps: number;
  clampReasons: GuardReasonRecord;
  dropReasons: GuardReasonRecord;
  timestamp: number;
}

export type BoardOpGuardTelemetryHandler = (event: BoardOpGuardTelemetryEvent) => void;

const boardOpGuardTelemetryHandlers = new Map<string, BoardOpGuardTelemetryHandler>();

export const setBoardOpGuardTelemetryHandlerForScope = (
  handler: BoardOpGuardTelemetryHandler | null,
  scopeKey: string,
) => {
  if (handler) {
    boardOpGuardTelemetryHandlers.set(scopeKey, handler);
    return;
  }
  boardOpGuardTelemetryHandlers.delete(scopeKey);
};

export const emitBoardOpGuardTelemetryForScope = (scopeKey: string, event: BoardOpGuardTelemetryEvent) => {
  const handler = boardOpGuardTelemetryHandlers.get(scopeKey);
  if (handler) {
    try {
      handler(event);
      return;
    } catch {
      // Swallow handler errors to keep guard execution safe.
    }
  }
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[board-op-guard:${scopeKey}]`, event);
  }
};

export const clearBoardOpGuardTelemetryHandlers = () => {
  boardOpGuardTelemetryHandlers.clear();
};

export interface BoardOpGuardHostNotice {
  kind: 'board_op_guard';
  scopeKey: string;
  severity: 'info' | 'warning';
  providerTag: string;
  message: string;
  droppedOps: number;
  clampedOps: number;
  fallbackOps: number;
}

export type BoardOpGuardHostNoticeHandler = (notice: BoardOpGuardHostNotice) => void;

const boardOpGuardHostNoticeHandlers = new Map<string, BoardOpGuardHostNoticeHandler>();

export const setBoardOpGuardHostNoticeHandlerForScope = (
  handler: BoardOpGuardHostNoticeHandler | null,
  scopeKey: string,
) => {
  if (handler) {
    boardOpGuardHostNoticeHandlers.set(scopeKey, handler);
    return;
  }
  boardOpGuardHostNoticeHandlers.delete(scopeKey);
};

export const notifyBoardOpGuardHostForScope = (scopeKey: string, notice: BoardOpGuardHostNotice) => {
  const handler = boardOpGuardHostNoticeHandlers.get(scopeKey);
  if (handler) {
    try {
      handler(notice);
      return;
    } catch {
      // Ignore host notice handler errors.
    }
  }
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info(`[board-op-guard:notice:${scopeKey}]`, notice);
  }
};

export const clearBoardOpGuardHostNoticeHandlers = () => {
  boardOpGuardHostNoticeHandlers.clear();
};

export interface GuardFallbackSequenceStore {
  next(scopeKey: string): number;
  delete(scopeKey: string): void;
  deleteBySuffix(suffix: string): void;
  clear(): void;
}

export const createGuardFallbackSequenceStore = (): GuardFallbackSequenceStore => {
  const sequences = new Map<string, number>();
  return {
    next(scopeKey: string) {
      const nextValue = (sequences.get(scopeKey) ?? 0) + 1;
      sequences.set(scopeKey, nextValue);
      return nextValue;
    },
    delete(scopeKey: string) {
      sequences.delete(scopeKey);
    },
    deleteBySuffix(suffix: string) {
      for (const key of Array.from(sequences.keys())) {
        if (key.endsWith(suffix)) {
          sequences.delete(key);
        }
      }
    },
    clear() {
      sequences.clear();
    },
  };
};

let guardFallbackSequenceStore: GuardFallbackSequenceStore = createGuardFallbackSequenceStore();

export const setGuardFallbackSequenceStore = (store: GuardFallbackSequenceStore | null) => {
  guardFallbackSequenceStore = store ?? createGuardFallbackSequenceStore();
};

export const getNextGuardFallbackSequence = (
  scopeKey: string,
  store?: GuardFallbackSequenceStore,
): number => {
  return (store ?? guardFallbackSequenceStore).next(scopeKey);
};

export const clearAllFallbackSequences = () => {
  guardFallbackSequenceStore.clear();
};

export const deleteFallbackSequenceByKey = (scopeKey: string) => {
  guardFallbackSequenceStore.delete(scopeKey);
};

export const deleteFallbackSequencesBySuffix = (suffix: string) => {
  guardFallbackSequenceStore.deleteBySuffix(suffix);
};
