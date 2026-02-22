import { applyBoardOps, clampBoardToCanvasBoundsInPlace, createEmptyBoardState } from '../../shared/board-state';
import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  collectAiInput,
  generateBoardOps,
  generateDiagramPatch,
  generatePersonalizedBoardOps,
  getAiProviderLabel,
  primeAiPromptSession,
  runAiPreflightCheck,
} from './ai-engine';
import { applyDiagramPatch } from './diagram-engine';
import {
  addTranscriptChunk,
  applyClientMessage,
  attachSocket,
  broadcastSnapshot,
  createRoom,
  createSocketData,
  detachSocket,
  getRoom,
  getOrCreateRoom,
} from './store';
import {
  appendPersonalizationContext,
  getPersonalizationProfile,
  getPersonalizationPromptLines,
  getPersonalizationStorePath,
} from './personalization-store';
import { getRuntimeConfig } from './runtime-config';
import { getTranscriptionProviderLabel, transcribeAudioBlob } from './transcription';
import type { BoardElement, BoardOp, BoardState, ClientMessage, TriggerPatchRequest } from '../../shared/types';

const runtimeConfig = getRuntimeConfig();
const PREFERRED_PORT = runtimeConfig.server.port;
const PORT_SCAN_SPAN = runtimeConfig.server.portScanSpan;
const LOG_LEVEL = runtimeConfig.logging?.level ?? 'debug';
const DEBUG_LOG_ENABLED = LOG_LEVEL === 'debug';
const TRANSCRIPTION_CHUNK_CAPTURE_ENABLED = runtimeConfig.capture?.transcriptionChunks?.enabled === true;
const TRANSCRIPTION_CHUNK_CAPTURE_DIR = runtimeConfig.capture?.transcriptionChunks?.directory
  ? resolve(runtimeConfig.capture.transcriptionChunks.directory)
  : join(tmpdir(), 'senseboard-transcribe-chunks');
const TRANSCRIPT_TEXT_ARCHIVE_DIR = join(process.cwd(), 'data', 'transcripts');
const TRANSCRIPT_TEXT_ARCHIVE_ENABLED =
  process.env.SENSEBOARD_TRANSCRIPT_ARCHIVE_ENABLED === '1' ||
  process.env.SENSEBOARD_TRANSCRIPT_ARCHIVE_ENABLED?.toLowerCase() === 'true';
const SERVER_STARTED_AT = Date.now();
const SERVER_INSTANCE_ID = `${SERVER_STARTED_AT.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface SocketData {
  roomId: string;
  memberId: string;
  memberName: string;
  handshakeAcked?: boolean;
  handshakeAckedAt?: number;
}

interface AiPatchJob {
  request: TriggerPatchRequest;
  resolve: (value: { applied: boolean; reason?: string; patch?: unknown }) => void;
}

interface AiQueueState {
  running: boolean;
  jobs: AiPatchJob[];
}

interface PersonalBoardState {
  board: BoardState;
  lastAiPatchAt: number;
  lastAiFingerprint: string;
  updatedAt: number;
}

interface PersonalizedAiPatchJob {
  request: TriggerPatchRequest;
  resolve: (value: { applied: boolean; reason?: string }) => void;
}

interface PersonalizedAiQueueState {
  running: boolean;
  jobs: PersonalizedAiPatchJob[];
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const logDebug = (message: string) => {
  if (LOG_LEVEL === 'debug') {
    console.log(`[SenseBoard][debug] ${message}`);
  }
};

const compactLogText = (value: string, maxLength = 280): string => {
  const flattened = value.replace(/\s+/g, ' ').trim();
  if (flattened.length <= maxLength) {
    return flattened;
  }
  return `${flattened.slice(0, maxLength)}...`;
};

const toSafeFileSegment = (value: string, fallback: string): string => {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
};

const toMimeExtension = (mimeType: string): string => {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase() ?? '';
  const cleaned = subtype.replace(/[^a-z0-9.+-]+/g, '');
  return cleaned || 'bin';
};

const captureTranscriptionChunk = async (roomId: string, speaker: string, audio: Blob): Promise<string | null> => {
  if (!TRANSCRIPTION_CHUNK_CAPTURE_ENABLED) {
    return null;
  }

  const extension = toMimeExtension(audio.type || '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${timestamp}-${toSafeFileSegment(roomId, 'room')}-${toSafeFileSegment(speaker, 'speaker')}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const filePath = join(TRANSCRIPTION_CHUNK_CAPTURE_DIR, fileName);

  try {
    await mkdir(TRANSCRIPTION_CHUNK_CAPTURE_DIR, { recursive: true });
    await Bun.write(filePath, audio);
    return filePath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logDebug(`Chunk capture failed room=${roomId} speaker=${speaker} error="${compactLogText(detail)}"`);
    return null;
  }
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });

const parseRoomId = (url: URL): string | null => {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'rooms' || !parts[1]) {
    return null;
  }
  return parts[1].toUpperCase();
};

const getRoomPathParts = (url: URL) => url.pathname.split('/').filter(Boolean);

const AI_MIN_INTERVAL_MS = 120;
const AI_MAX_QUEUE_LENGTH = 120;
const PERSONAL_AI_MIN_INTERVAL_MS = 140;
const PERSONAL_AI_MAX_QUEUE_LENGTH = 120;
const PERSONAL_AI_DEFER_AFTER_MAIN_MS = 240;
const MAIN_QUEUE_WAIT_SLICE_MS = 20;
const MAIN_QUEUE_WAIT_TIMEOUT_MS = 1500;
const MIN_TRANSCRIBE_AUDIO_BYTES = 1024;
const AI_LAYER_SHIFT_Y = 520;
const AI_LAYER_BOUNDARY_Y = 5600;
const AI_IDLE_AFTER_INACTIVITY_MS = 10 * 60 * 1000;
const aiQueueByRoom = new Map<string, AiQueueState>();
const personalBoardStateByRoom = new Map<string, Map<string, PersonalBoardState>>();
const personalAiQueueByKey = new Map<string, PersonalizedAiQueueState>();
const deferredPersonalAiByRoom = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>;
    request: TriggerPatchRequest;
  }
>();
const lastStoredTranscriptBySpeaker = new Map<string, string>();
const aiLastActivityByRoom = new Map<string, number>();
const aiIdleTimerByRoom = new Map<string, ReturnType<typeof setTimeout>>();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getQueueState = (roomId: string): AiQueueState => {
  const existing = aiQueueByRoom.get(roomId);
  if (existing) {
    return existing;
  }
  const fresh: AiQueueState = { running: false, jobs: [] };
  aiQueueByRoom.set(roomId, fresh);
  return fresh;
};

const normalizeNameKey = (name: string): string => name.trim().toLowerCase();

const persistTranscriptContext = (roomId: string, speaker: string, text: string) => {
  if (!TRANSCRIPT_TEXT_ARCHIVE_ENABLED) {
    return;
  }
  const normalizedSpeaker = speaker.trim();
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  if (!normalizedSpeaker || !normalizedText) {
    return;
  }

  const dedupeKey = `${roomId.trim().toUpperCase()}::${normalizeNameKey(normalizedSpeaker)}`;
  const previous = lastStoredTranscriptBySpeaker.get(dedupeKey);
  if (previous === normalizedText) {
    return;
  }

  lastStoredTranscriptBySpeaker.set(dedupeKey, normalizedText);
  const roomKey = roomId.trim().toUpperCase();
  const safeRoom = toSafeFileSegment(roomKey, 'room');
  const safeSpeaker = toSafeFileSegment(normalizedSpeaker, 'speaker');
  const line = JSON.stringify({
    at: new Date().toISOString(),
    roomId: roomKey,
    speaker: normalizedSpeaker,
    text: normalizedText,
  });
  void mkdir(TRANSCRIPT_TEXT_ARCHIVE_DIR, { recursive: true })
    .then(() => appendFile(join(TRANSCRIPT_TEXT_ARCHIVE_DIR, `${safeRoom}.${safeSpeaker}.jsonl`), `${line}\n`, 'utf8'))
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logDebug(
        `Transcript text archive write failed room=${roomKey} speaker=${normalizedSpeaker} error="${compactLogText(detail)}"`,
      );
    });
};

const markAiActivity = (
  room: ReturnType<typeof getOrCreateRoom>,
  status: 'listening' | 'updating' = 'listening',
) => {
  if (room.aiConfig.frozen) {
    room.aiConfig.status = 'frozen';
    return;
  }
  const now = Date.now();
  aiLastActivityByRoom.set(room.id, now);
  const previousTimer = aiIdleTimerByRoom.get(room.id);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  if (room.aiConfig.status !== status) {
    room.aiConfig.status = status;
    broadcastSnapshot(room.id);
  }

  const timer = setTimeout(() => {
    const latestActivityAt = aiLastActivityByRoom.get(room.id) ?? 0;
    if (latestActivityAt !== now) {
      return;
    }
    const latestRoom = getRoom(room.id);
    if (!latestRoom || latestRoom.aiConfig.frozen) {
      return;
    }
    if (latestRoom.aiConfig.status !== 'idle') {
      latestRoom.aiConfig.status = 'idle';
      broadcastSnapshot(latestRoom.id);
    }
    aiIdleTimerByRoom.delete(room.id);
  }, AI_IDLE_AFTER_INACTIVITY_MS);
  aiIdleTimerByRoom.set(room.id, timer);
};

const toPersonalQueueKey = (roomId: string, memberName: string): string => {
  return `${roomId.toUpperCase()}::${normalizeNameKey(memberName)}`;
};

const getPersonalizedQueueState = (roomId: string, memberName: string): PersonalizedAiQueueState => {
  const queueKey = toPersonalQueueKey(roomId, memberName);
  const existing = personalAiQueueByKey.get(queueKey);
  if (existing) {
    return existing;
  }
  const fresh: PersonalizedAiQueueState = { running: false, jobs: [] };
  personalAiQueueByKey.set(queueKey, fresh);
  return fresh;
};

const getOrCreatePersonalBoardState = (roomId: string, memberName: string): PersonalBoardState => {
  const normalizedRoomId = roomId.trim().toUpperCase();
  const nameKey = normalizeNameKey(memberName);
  let roomMap = personalBoardStateByRoom.get(normalizedRoomId);
  if (!roomMap) {
    roomMap = new Map<string, PersonalBoardState>();
    personalBoardStateByRoom.set(normalizedRoomId, roomMap);
  }
  const existing = roomMap.get(nameKey);
  if (existing) {
    return existing;
  }
  const fresh: PersonalBoardState = {
    board: createEmptyBoardState(),
    lastAiPatchAt: 0,
    lastAiFingerprint: '',
    updatedAt: 0,
  };
  roomMap.set(nameKey, fresh);
  return fresh;
};

const waitForMainQueueDrain = async (roomId: string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAIN_QUEUE_WAIT_TIMEOUT_MS) {
    const mainQueue = getQueueState(roomId);
    if (!mainQueue.running && mainQueue.jobs.length === 0) {
      return;
    }
    await sleep(MAIN_QUEUE_WAIT_SLICE_MS);
  }
};

const boardOpsContainRenderableOutput = (ops: BoardOp[]): boolean => {
  const hasRenderable = (op: BoardOp): boolean => {
    if (op.type === 'batch') {
      return op.ops.some((nested) => hasRenderable(nested));
    }
    if (op.type === 'setViewport') {
      return false;
    }
    return true;
  };
  return ops.some((op) => hasRenderable(op));
};

const boardStateChanged = (before: BoardState, after: BoardState): boolean => {
  return after.revision !== before.revision;
};

const aiInputHasSignal = (
  input: Partial<ReturnType<typeof collectAiInput>>,
): boolean => {
  const transcriptWindow = Array.isArray(input.transcriptWindow) ? input.transcriptWindow : [];
  const recentChat = Array.isArray(input.recentChat) ? input.recentChat : [];
  const corrections = Array.isArray(input.corrections) ? input.corrections : [];
  const contextPinnedHigh = Array.isArray(input.contextPinnedHigh) ? input.contextPinnedHigh : [];
  const contextPinnedNormal = Array.isArray(input.contextPinnedNormal) ? input.contextPinnedNormal : [];
  const visualHint = typeof input.visualHint === 'string' ? input.visualHint : '';

  if (transcriptWindow.length > 0) {
    return true;
  }
  if (recentChat.length > 0 || corrections.length > 0) {
    return true;
  }
  if (contextPinnedHigh.length > 0 || contextPinnedNormal.length > 0) {
    return true;
  }
  return visualHint.trim().length > 0;
};

const createLayerId = (): string => {
  return `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const shiftElementDown = (element: BoardElement, deltaY: number): BoardElement => {
  if (element.kind === 'text') {
    return {
      ...element,
      y: element.y + deltaY,
    };
  }
  if (
    element.kind === 'rect' ||
    element.kind === 'ellipse' ||
    element.kind === 'diamond' ||
    element.kind === 'triangle' ||
    element.kind === 'sticky' ||
    element.kind === 'frame'
  ) {
    return {
      ...element,
      y: element.y + deltaY,
    };
  }
  if (element.kind === 'line' || element.kind === 'stroke' || element.kind === 'arrow') {
    return {
      ...element,
      points: element.points.map(([x, y]) => [x, y + deltaY] as [number, number]),
    };
  }
  return element;
};

const isElementPastBoundary = (element: BoardElement, boundaryY: number): boolean => {
  if (element.kind === 'text') {
    return element.y > boundaryY;
  }
  if (
    element.kind === 'rect' ||
    element.kind === 'ellipse' ||
    element.kind === 'diamond' ||
    element.kind === 'triangle' ||
    element.kind === 'sticky' ||
    element.kind === 'frame'
  ) {
    return element.y > boundaryY;
  }
  if (element.kind === 'line' || element.kind === 'stroke' || element.kind === 'arrow') {
    if (element.points.length === 0) {
      return true;
    }
    return element.points.every(([, y]) => y > boundaryY);
  }
  return false;
};

const shiftAiElementsDown = (
  board: BoardState,
  deltaY: number,
  boundaryY: number,
): {
  board: BoardState;
  shiftedCount: number;
  droppedCount: number;
} => {
  const next = structuredClone(board);
  const elements: BoardState['elements'] = {};
  const order: string[] = [];
  let shiftedCount = 0;
  let droppedCount = 0;

  for (const id of next.order) {
    const existing = next.elements[id];
    if (!existing) {
      continue;
    }

    if (existing.createdBy !== 'ai') {
      elements[id] = existing;
      order.push(id);
      continue;
    }

    shiftedCount += 1;
    const shifted = shiftElementDown(existing, deltaY);
    if (isElementPastBoundary(shifted, boundaryY)) {
      droppedCount += 1;
      continue;
    }

    elements[id] = shifted;
    order.push(id);
  }

  next.elements = elements;
  next.order = order;
  if (shiftedCount > 0 || droppedCount > 0) {
    next.revision += 1;
    next.lastUpdatedAt = Date.now();
  }

  return {
    board: next,
    shiftedCount,
    droppedCount,
  };
};

const namespaceBoardOpsForLayer = (ops: BoardOp[], layerId: string): BoardOp[] => {
  const toLayerId = (id: string) => `${layerId}:${id}`;
  const rewrite = (op: BoardOp): BoardOp[] => {
    if (op.type === 'clearBoard') {
      // Preserve older layers by ignoring AI clear requests.
      return [];
    }
    if (op.type === 'upsertElement') {
      return [
        {
          ...op,
          element: {
            ...op.element,
            id: toLayerId(op.element.id),
          },
        },
      ];
    }
    if (op.type === 'appendStrokePoints') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'deleteElement') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'offsetElement') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'setElementStyle') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'setElementGeometry') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'setElementText') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'duplicateElement') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
          newId: toLayerId(op.newId),
        },
      ];
    }
    if (op.type === 'setElementZIndex') {
      return [
        {
          ...op,
          id: toLayerId(op.id),
        },
      ];
    }
    if (op.type === 'alignElements') {
      return [
        {
          ...op,
          ids: op.ids.map((id) => toLayerId(id)),
        },
      ];
    }
    if (op.type === 'distributeElements') {
      return [
        {
          ...op,
          ids: op.ids.map((id) => toLayerId(id)),
        },
      ];
    }
    if (op.type === 'batch') {
      const nested = op.ops.flatMap((item) => rewrite(item));
      if (nested.length === 0) {
        return [];
      }
      return [
        {
          type: 'batch',
          ops: nested,
        },
      ];
    }
    return [op];
  };

  return ops.flatMap((op) => rewrite(op));
};

const applyStackedBoardOps = (
  board: BoardState,
  ops: BoardOp[],
): {
  shiftedBoard: BoardState;
  layeredOps: BoardOp[];
  boardAfterOps: BoardState;
  shiftedCount: number;
  droppedCount: number;
  boundaryAdjustedCount: number;
} => {
  const shifted = shiftAiElementsDown(board, AI_LAYER_SHIFT_Y, AI_LAYER_BOUNDARY_Y);
  const layeredOps = namespaceBoardOpsForLayer(ops, createLayerId());
  const boardAfterOps = applyBoardOps(shifted.board, layeredOps);
  const boundaryAdjustedCount = clampBoardToCanvasBoundsInPlace(boardAfterOps);

  return {
    shiftedBoard: shifted.board,
    layeredOps,
    boardAfterOps,
    shiftedCount: shifted.shiftedCount,
    droppedCount: shifted.droppedCount,
    boundaryAdjustedCount,
  };
};

const runAiPatchRequest = async (
  roomId: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string; patch?: unknown }> => {
  const room = getOrCreateRoom(roomId);
  const reason = request.reason ?? 'manual';
  const regenerate = Boolean(request.regenerate);
  const windowSeconds = request.windowSeconds ?? 30;
  const aiInputPreview = collectAiInput(room, windowSeconds, {
    reason,
    regenerate,
    transcriptChunkCount: request.transcriptChunkCount,
  });
  if (DEBUG_LOG_ENABLED) {
    const transcriptForAi = aiInputPreview.transcriptWindow.slice(-6).join(' || ');
    logDebug(
      `Main AI input room=${room.id} reason=${reason} regenerate=${regenerate} transcriptLines=${aiInputPreview.transcriptWindow.length} transcriptCursor=${request.transcriptChunkCount ?? room.transcriptChunks.length} text="${compactLogText(transcriptForAi, 720)}"`,
    );
  }

  if (room.aiConfig.frozen && !regenerate) {
    logDebug(`Main AI skipped room=${room.id} reason=frozen`);
    return { applied: false, reason: 'frozen' };
  }

  if (!regenerate) {
    const waitMs = Math.max(0, AI_MIN_INTERVAL_MS - (Date.now() - room.lastAiPatchAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  if (reason === 'tick' && !aiInputHasSignal(aiInputPreview)) {
    logDebug(`Main AI skipped room=${room.id} reason=no_signal`);
    markAiActivity(room, 'listening');
    return { applied: false, reason: 'no_signal' };
  }

  markAiActivity(room, 'updating');
  const boardOpsResult = await generateBoardOps(room, {
    reason,
    regenerate,
    windowSeconds,
    transcriptChunkCount: request.transcriptChunkCount,
  }).catch(() => null);
  const stackedBoardOps = boardOpsResult ? applyStackedBoardOps(room.board, boardOpsResult.ops) : null;
  const boardAfterBoardOps = stackedBoardOps?.boardAfterOps ?? null;
  const boardOpsMutatedBoard =
    stackedBoardOps && boardAfterBoardOps
      ? boardStateChanged(stackedBoardOps.shiftedBoard, boardAfterBoardOps)
      : false;
  const boardOpsRenderableOutput = stackedBoardOps ? boardOpsContainRenderableOutput(stackedBoardOps.layeredOps) : false;

  if (!regenerate && reason === 'tick' && boardOpsResult && boardOpsResult.fingerprint === room.lastAiFingerprint) {
    logDebug(`Main AI result room=${room.id} reason=no_change fingerprint=${boardOpsResult.fingerprint}`);
    markAiActivity(room, 'listening');
    return { applied: false, reason: 'no_change' };
  }

  const shouldFallbackToDiagramPatch =
    !boardOpsResult ||
    boardOpsResult.ops.length === 0 ||
    !boardOpsRenderableOutput ||
    !boardOpsMutatedBoard;

  if (shouldFallbackToDiagramPatch) {
    if (!regenerate && reason === 'tick' && (!boardOpsResult || boardOpsResult.ops.length === 0)) {
      logDebug(`Main AI board-ops result room=${room.id} reason=no_change_empty_ops`);
      markAiActivity(room, 'listening');
      return { applied: false, reason: 'no_change' };
    }
    if (!boardOpsResult || boardOpsResult.ops.length === 0) {
      logDebug(`Main AI board-ops result room=${room.id} reason=ai_no_response fallback=diagram_patch`);
    } else if (!boardOpsMutatedBoard) {
      logDebug(
        `Main AI board-ops result room=${room.id} reason=no_effect ops=${boardOpsResult.ops.length} fallback=diagram_patch`,
      );
    } else {
      logDebug(
        `Main AI board-ops result room=${room.id} reason=non_visual_ops_only ops=${stackedBoardOps?.layeredOps.length ?? boardOpsResult.ops.length} fallback=diagram_patch`,
      );
    }
    const diagramPatchResult = await generateDiagramPatch(room, {
      reason,
      regenerate,
      windowSeconds,
      transcriptChunkCount: request.transcriptChunkCount,
    }).catch(() => null);
    if (!diagramPatchResult) {
      logDebug(`Main AI fallback room=${room.id} reason=diagram_patch_failed`);
      markAiActivity(room, 'listening');
      return { applied: false, reason: 'ai_no_response' };
    }
    const applied = applyDiagramPatch(room, diagramPatchResult.patch, { regenerate });
    if (!applied) {
      logDebug(`Main AI fallback room=${room.id} reason=diagram_patch_not_applied`);
      markAiActivity(room, 'listening');
      return { applied: false, reason: 'ai_no_response' };
    }
    room.lastAiFingerprint = `${diagramPatchResult.fingerprint}:diagram_patch`;
    const fallbackBoundaryAdjusted = clampBoardToCanvasBoundsInPlace(room.board);
    markAiActivity(room, 'listening');
    logDebug(
      `Main AI fallback applied room=${room.id} actions=${diagramPatchResult.patch.actions.length} boundaryAdjusted=${fallbackBoundaryAdjusted} fingerprint=${room.lastAiFingerprint}`,
    );
    broadcastSnapshot(room.id);
    return {
      applied: true,
      patch: {
        kind: 'diagram_patch',
        patch: diagramPatchResult.patch,
      },
    };
  }

  if (!boardAfterBoardOps) {
    markAiActivity(room, 'listening');
    return { applied: false, reason: 'ai_no_response' };
  }

  room.board = boardAfterBoardOps;
  room.lastAiPatchAt = Date.now();
  room.lastAiFingerprint = boardOpsResult.fingerprint;
  markAiActivity(room, 'listening');
  logDebug(
    `Main AI applied room=${room.id} ops=${stackedBoardOps?.layeredOps.length ?? boardOpsResult.ops.length} shifted=${stackedBoardOps?.shiftedCount ?? 0} dropped=${stackedBoardOps?.droppedCount ?? 0} bounded=${stackedBoardOps?.boundaryAdjustedCount ?? 0} elements=${room.board.order.length} fingerprint=${boardOpsResult.fingerprint}`,
  );
  broadcastSnapshot(room.id);
  return {
    applied: true,
    patch: {
      kind: 'board_ops',
      ops: boardOpsResult.ops,
      ...(typeof boardOpsResult.text === 'string' && boardOpsResult.text.trim().length > 0
        ? { text: boardOpsResult.text }
        : {}),
    },
  };
};

const runPersonalizedPatchRequest = async (
  roomId: string,
  memberName: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string }> => {
  const normalizedMemberName = memberName.trim();
  if (!normalizedMemberName) {
    return { applied: false, reason: 'missing_name' };
  }

  await waitForMainQueueDrain(roomId);

  const room = getOrCreateRoom(roomId);
  const reason = request.reason ?? 'manual';
  const regenerate = Boolean(request.regenerate);
  const windowSeconds = request.windowSeconds ?? 30;

  const aiInputPreview = collectAiInput(room, windowSeconds, {
    reason,
    regenerate,
    transcriptChunkCount: request.transcriptChunkCount,
  });
  if (reason === 'tick' && !aiInputHasSignal(aiInputPreview)) {
    logDebug(`Personal AI skipped room=${room.id} member=${normalizedMemberName} reason=no_signal`);
    return { applied: false, reason: 'no_signal' };
  }

  const personalBoardState = getOrCreatePersonalBoardState(room.id, normalizedMemberName);
  if (!regenerate) {
    const waitMs = Math.max(0, PERSONAL_AI_MIN_INTERVAL_MS - (Date.now() - personalBoardState.lastAiPatchAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  const personalizationLines = getPersonalizationPromptLines(normalizedMemberName, 12);
  const result = await generatePersonalizedBoardOps(room, request, {
    memberName: normalizedMemberName,
    contextLines: personalizationLines,
  }).catch(() => null);

  if (!result || result.ops.length === 0) {
    if (!regenerate && reason === 'tick') {
      logDebug(`Personal AI result room=${room.id} member=${normalizedMemberName} reason=no_change_empty_ops`);
      return { applied: false, reason: 'no_change' };
    }
    logDebug(`Personal AI result room=${room.id} member=${normalizedMemberName} reason=ai_no_response`);
    return { applied: false, reason: 'ai_no_response' };
  }

  const stackedResult = applyStackedBoardOps(personalBoardState.board, result.ops);
  const hasRenderableLayeredOps = boardOpsContainRenderableOutput(stackedResult.layeredOps);
  const personalBoardMutated = boardStateChanged(stackedResult.shiftedBoard, stackedResult.boardAfterOps);
  if (!hasRenderableLayeredOps || !personalBoardMutated) {
    logDebug(
      `Personal AI result room=${room.id} member=${normalizedMemberName} reason=no_effect layeredOps=${stackedResult.layeredOps.length}`,
    );
    return { applied: false, reason: 'ai_no_response' };
  }

  if (!regenerate && reason === 'tick' && result.fingerprint === personalBoardState.lastAiFingerprint) {
    logDebug(`Personal AI result room=${room.id} member=${normalizedMemberName} reason=no_change`);
    return { applied: false, reason: 'no_change' };
  }

  personalBoardState.board = stackedResult.boardAfterOps;
  personalBoardState.lastAiFingerprint = result.fingerprint;
  personalBoardState.lastAiPatchAt = Date.now();
  personalBoardState.updatedAt = Date.now();
  logDebug(
    `Personal AI applied room=${room.id} member=${normalizedMemberName} ops=${stackedResult.layeredOps.length} shifted=${stackedResult.shiftedCount} dropped=${stackedResult.droppedCount} bounded=${stackedResult.boundaryAdjustedCount} fingerprint=${result.fingerprint}`,
  );
  return { applied: true };
};

const processRoomQueue = async (roomId: string) => {
  const queueState = getQueueState(roomId);
  if (queueState.running) {
    return;
  }
  queueState.running = true;
  try {
    while (queueState.jobs.length > 0) {
      const job = queueState.jobs.shift();
      if (!job) {
        continue;
      }
      try {
        const result = await runAiPatchRequest(roomId, job.request);
        job.resolve(result);
      } catch {
        job.resolve({ applied: false, reason: 'ai_error' });
      }
    }
  } finally {
    queueState.running = false;
  }
};

const processPersonalizedQueue = async (roomId: string, memberName: string) => {
  const queueState = getPersonalizedQueueState(roomId, memberName);
  if (queueState.running) {
    return;
  }
  queueState.running = true;
  try {
    while (queueState.jobs.length > 0) {
      const job = queueState.jobs.shift();
      if (!job) {
        continue;
      }
      try {
        const result = await runPersonalizedPatchRequest(roomId, memberName, job.request);
        job.resolve(result);
      } catch {
        job.resolve({ applied: false, reason: 'ai_error' });
      }
    }
  } finally {
    queueState.running = false;
  }
};

const enqueueAiPatch = (
  roomId: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string; patch?: unknown }> => {
  const queueState = getQueueState(roomId);
  if (request.reason === 'tick' && !request.regenerate) {
    const pendingTick = queueState.jobs.find((job) => job.request.reason === 'tick' && !job.request.regenerate);
    if (pendingTick) {
      const incomingCursor = request.transcriptChunkCount;
      const existingCursor = pendingTick.request.transcriptChunkCount;
      if (typeof incomingCursor === 'number' && Number.isFinite(incomingCursor)) {
        pendingTick.request.transcriptChunkCount =
          typeof existingCursor === 'number' && Number.isFinite(existingCursor)
            ? Math.max(existingCursor, incomingCursor)
            : incomingCursor;
      }
      pendingTick.request.windowSeconds = request.windowSeconds ?? pendingTick.request.windowSeconds;
      return Promise.resolve({ applied: false, reason: 'queued' });
    }
  }
  while (queueState.jobs.length >= AI_MAX_QUEUE_LENGTH) {
    const dropped = queueState.jobs.shift();
    dropped?.resolve({ applied: false, reason: 'queue_overflow' });
  }
  return new Promise((resolve) => {
    queueState.jobs.push({ request, resolve });
    void processRoomQueue(roomId);
  });
};

const enqueuePersonalizedAiPatch = (
  roomId: string,
  memberName: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string }> => {
  const normalizedMemberName = memberName.trim();
  if (!normalizedMemberName) {
    return Promise.resolve({ applied: false, reason: 'missing_name' });
  }
  const queueState = getPersonalizedQueueState(roomId, normalizedMemberName);
  if (request.reason === 'tick' && !request.regenerate) {
    const pendingTick = queueState.jobs.find((job) => job.request.reason === 'tick' && !job.request.regenerate);
    if (pendingTick) {
      const incomingCursor = request.transcriptChunkCount;
      const existingCursor = pendingTick.request.transcriptChunkCount;
      if (typeof incomingCursor === 'number' && Number.isFinite(incomingCursor)) {
        pendingTick.request.transcriptChunkCount =
          typeof existingCursor === 'number' && Number.isFinite(existingCursor)
            ? Math.max(existingCursor, incomingCursor)
            : incomingCursor;
      }
      pendingTick.request.windowSeconds = request.windowSeconds ?? pendingTick.request.windowSeconds;
      return Promise.resolve({ applied: false, reason: 'queued' });
    }
  }
  while (queueState.jobs.length >= PERSONAL_AI_MAX_QUEUE_LENGTH) {
    const dropped = queueState.jobs.shift();
    dropped?.resolve({ applied: false, reason: 'queue_overflow' });
  }
  return new Promise((resolve) => {
    queueState.jobs.push({ request, resolve });
    void processPersonalizedQueue(roomId, normalizedMemberName);
  });
};

const enqueuePersonalizedAiPatchForRoomMembers = (
  roomId: string,
  request: TriggerPatchRequest,
) => {
  const room = getOrCreateRoom(roomId);
  const names = Array.from(
    new Set(
      room.members
        .map((member) => member.name.trim())
        .filter((name) => name.length > 0),
    ),
  );
  names.forEach((memberName) => {
    void enqueuePersonalizedAiPatch(room.id, memberName, request);
  });
};

const mergeDeferredPersonalRequest = (
  previous: TriggerPatchRequest,
  incoming: TriggerPatchRequest,
): TriggerPatchRequest => {
  const merged: TriggerPatchRequest = {
    reason: incoming.reason ?? previous.reason ?? 'tick',
    regenerate: Boolean(previous.regenerate || incoming.regenerate),
    windowSeconds: incoming.windowSeconds ?? previous.windowSeconds ?? 30,
    transcriptChunkCount: previous.transcriptChunkCount,
  };
  const incomingCursor = incoming.transcriptChunkCount;
  const existingCursor = previous.transcriptChunkCount;
  if (typeof incomingCursor === 'number' && Number.isFinite(incomingCursor)) {
    merged.transcriptChunkCount =
      typeof existingCursor === 'number' && Number.isFinite(existingCursor)
        ? Math.max(existingCursor, incomingCursor)
        : incomingCursor;
  }
  return merged;
};

const scheduleDeferredPersonalizedAiPatch = (
  roomId: string,
  request: TriggerPatchRequest,
  delayMs = PERSONAL_AI_DEFER_AFTER_MAIN_MS,
) => {
  const normalizedRoomId = roomId.trim().toUpperCase();
  const previous = deferredPersonalAiByRoom.get(normalizedRoomId);
  const mergedRequest = previous ? mergeDeferredPersonalRequest(previous.request, request) : request;
  if (previous) {
    clearTimeout(previous.timer);
  }
  const timer = setTimeout(() => {
    deferredPersonalAiByRoom.delete(normalizedRoomId);
    enqueuePersonalizedAiPatchForRoomMembers(normalizedRoomId, mergedRequest);
  }, Math.max(0, delayMs));
  deferredPersonalAiByRoom.set(normalizedRoomId, {
    timer,
    request: mergedRequest,
  });
};

const scheduleTranscriptPatch = (roomId: string, transcriptChunkCount?: number) => {
  const room = getOrCreateRoom(roomId);
  if (room.aiConfig.frozen) {
    logDebug(`Skip transcript AI patch room=${room.id} reason=frozen`);
    return;
  }
  markAiActivity(room, 'listening');
  const cursor =
    typeof transcriptChunkCount === 'number' && Number.isFinite(transcriptChunkCount)
      ? Math.max(0, Math.floor(transcriptChunkCount))
      : room.transcriptChunks.length;
  logDebug(`Enqueue transcript AI patch room=${room.id} reason=tick transcriptCursor=${cursor}`);
  const request: TriggerPatchRequest = {
    reason: 'tick',
    windowSeconds: 30,
    transcriptChunkCount: cursor,
  };
  void enqueueAiPatch(room.id, request).finally(() => {
    scheduleDeferredPersonalizedAiPatch(room.id, request);
  });
};

export const fetchHandler = async (
  request: Request,
  server: any,
): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/ws') {
      const roomId = url.searchParams.get('roomId');
      const memberName = url.searchParams.get('name') ?? '';
      if (!roomId) {
        return json({ error: 'roomId is required' }, 400);
      }
      if (!memberName.trim()) {
        return json({ error: 'name is required' }, 400);
      }
      getPersonalizationProfile(memberName);
      const data = createSocketData(roomId, memberName);
      const upgraded = server.upgrade(request, { data });
      if (!upgraded) {
        return json({ error: 'websocket upgrade failed' }, 500);
      }
      return undefined;
    }

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        now: new Date().toISOString(),
        instanceStartedAt: SERVER_STARTED_AT,
        instanceId: SERVER_INSTANCE_ID,
      });
    }

    if (url.pathname === '/ai/preflight' && request.method === 'GET') {
      const result = await runAiPreflightCheck();
      return json(result, result.ok ? 200 : 503);
    }

    if (url.pathname === '/personalization/context' && request.method === 'GET') {
      const name = (url.searchParams.get('name') ?? '').trim();
      if (!name) {
        return json({ error: 'name is required' }, 400);
      }
      const profile = getPersonalizationProfile(name);
      return json({
        profile: {
          nameKey: profile.nameKey,
          displayName: profile.displayName,
          contextLines: profile.contextLines,
          updatedAt: profile.updatedAt,
        },
      });
    }

    if (url.pathname === '/personalization/context' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        text?: string;
      };
      const name = (body.name ?? '').trim();
      const text = (body.text ?? '').trim();
      if (!name) {
        return json({ error: 'name is required' }, 400);
      }
      if (!text) {
        return json({ error: 'text is required' }, 400);
      }
      const profile = appendPersonalizationContext(name, text);
      logDebug(`Personalization context updated member=${profile.displayName} lines=${profile.contextLines.length}`);
      return json({
        ok: true,
        profile: {
          nameKey: profile.nameKey,
          displayName: profile.displayName,
          contextLines: profile.contextLines,
          updatedAt: profile.updatedAt,
        },
      });
    }

    if (url.pathname === '/rooms' && request.method === 'POST') {
      const room = createRoom();
      return json({ roomId: room.id, room });
    }

    const pathParts = getRoomPathParts(url);

    if (pathParts[0] === 'rooms' && pathParts.length === 2 && request.method === 'GET') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const room = getOrCreateRoom(roomId);
      return json({ room });
    }

    if (pathParts[0] === 'rooms' && pathParts[2] === 'personal-board' && request.method === 'GET') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const memberName = (url.searchParams.get('name') ?? '').trim();
      if (!memberName) {
        return json({ error: 'name is required' }, 400);
      }
      const personalBoardState = getOrCreatePersonalBoardState(roomId, memberName);
      return json({
        board: personalBoardState.board,
        updatedAt: personalBoardState.updatedAt,
      });
    }

    if (pathParts[0] === 'rooms' && pathParts[2] === 'personal-board' && pathParts[3] === 'ai-patch' && request.method === 'POST') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const payload = (await request.json().catch(() => ({}))) as
        Partial<TriggerPatchRequest> & {
          name?: string;
        };
      const memberName = (payload.name ?? '').trim();
      if (!memberName) {
        return json({ error: 'name is required' }, 400);
      }
      const queueRequest: TriggerPatchRequest = {
        reason: payload.reason ?? 'manual',
        regenerate: Boolean(payload.regenerate),
        windowSeconds: payload.windowSeconds ?? 30,
      };
      logDebug(
        `Personal AI enqueue requested room=${roomId} member=${memberName} reason=${queueRequest.reason ?? 'manual'} regenerate=${Boolean(queueRequest.regenerate)}`,
      );
      void enqueuePersonalizedAiPatch(roomId, memberName, queueRequest).catch(() => undefined);
      return json({
        applied: false,
        reason: 'queued',
      });
    }

    if (pathParts[0] === 'rooms' && pathParts[2] === 'ai-patch' && request.method === 'POST') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const payload = (await request.json().catch(() => ({}))) as Partial<TriggerPatchRequest>;
      const sharedRequest: TriggerPatchRequest = {
        reason: payload.reason ?? 'manual',
        regenerate: Boolean(payload.regenerate),
        windowSeconds: payload.windowSeconds ?? 30,
      };
      const result = await enqueueAiPatch(roomId, sharedRequest);
      scheduleDeferredPersonalizedAiPatch(roomId, sharedRequest, 0);
      return json(result);
    }

    if (pathParts[0] === 'rooms' && pathParts[2] === 'transcribe' && request.method === 'POST') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }

      const body = await request.formData().catch(() => null);
      if (!body) {
        return json({ ok: false, error: 'multipart form-data is required' }, 400);
      }

      const audioValue = body.get('audio');
      const speakerValue = body.get('speaker');
      const speaker = typeof speakerValue === 'string' && speakerValue.trim() ? speakerValue.trim() : 'Speaker';

      if (!(audioValue instanceof Blob) || audioValue.size === 0) {
        logDebug(`Transcribe request invalid room=${roomId} speaker=${speaker} reason=missing_audio`);
        return json({ ok: false, error: 'audio file is required' }, 400);
      }
      if (audioValue.size < MIN_TRANSCRIBE_AUDIO_BYTES) {
        logDebug(
          `Transcribe request skipped room=${roomId} speaker=${speaker} reason=audio_too_small bytes=${audioValue.size}`,
        );
        return json({
          ok: true,
          text: '',
          accepted: false,
          reason: 'audio_too_small',
        });
      }

      logDebug(
        `Transcribe request received room=${roomId} speaker=${speaker} audioBytes=${audioValue.size} mime=${audioValue.type || 'unknown'}`,
      );
      const capturedChunkPath = await captureTranscriptionChunk(roomId, speaker, audioValue);
      if (capturedChunkPath) {
        logDebug(`Transcribe chunk captured room=${roomId} speaker=${speaker} file=${capturedChunkPath}`);
      }

      const transcription = await transcribeAudioBlob(audioValue);
      if (!transcription.ok) {
        logDebug(
          `Transcription failed room=${roomId} speaker=${speaker} provider=${transcription.provider ?? 'unknown'} error="${compactLogText(transcription.error ?? 'unknown')}"`,
        );
        return json(transcription, 503);
      }

      const text = transcription.text.trim();
      if (!text) {
        logDebug(
          `Transcription returned empty text room=${roomId} speaker=${speaker} provider=${transcription.provider ?? 'unknown'}`,
        );
        logDebug(`Skip transcript AI patch room=${roomId} reason=empty_transcript`);
        return json({
          ok: true,
          text: '',
          accepted: false,
          reason: 'empty_transcript',
        });
      }

      const room = getOrCreateRoom(roomId);
      const accepted = addTranscriptChunk(room, {
        speaker,
        text,
        source: 'mic',
      });
      if (!accepted) {
        logDebug(
          `Transcription rejected room=${room.id} speaker=${speaker} provider=${transcription.provider ?? 'unknown'}`,
        );
        logDebug(`Skip transcript AI patch room=${room.id} reason=empty_transcript`);
        return json({
          ok: true,
          text: '',
          accepted: false,
          reason: 'empty_transcript',
        });
      }

      logDebug(
        `Transcription accepted room=${room.id} speaker=${speaker} provider=${transcription.provider ?? 'unknown'} text="${compactLogText(text)}"`,
      );
      persistTranscriptContext(room.id, speaker, text);

      scheduleTranscriptPatch(room.id, room.transcriptChunks.length);
      broadcastSnapshot(room.id);
      return json({
        ok: true,
        text,
        accepted: true,
      });
    }

    return json({ error: 'not_found' }, 404);
};

export const websocketHandler = {
  open: (ws: any) => {
    attachSocket(ws as unknown as Parameters<typeof attachSocket>[0]);
  },
  message: (ws: any, message: unknown) => {
    const socket = ws as unknown as Parameters<typeof attachSocket>[0];
    try {
      const parsed = JSON.parse(String(message)) as ClientMessage;
      const room = getOrCreateRoom(socket.data.roomId);
      if (parsed.type === 'client:ack') {
        socket.data.handshakeAcked = true;
        socket.data.handshakeAckedAt = Date.now();
        logDebug(`Handshake ACK received room=${room.id} member=${socket.data.memberName}`);
        socket.send(
          JSON.stringify({
            type: 'server:ack',
            payload: {
              protocol: 'senseboard-ws-v1',
              roomId: room.id,
              memberId: socket.data.memberId,
              receivedAt: socket.data.handshakeAckedAt,
            },
          }),
        );
        return;
      }
      if (!socket.data.handshakeAcked) {
        socket.send(
          JSON.stringify({
            type: 'room:error',
            payload: { message: 'Handshake required. Send client:ack first.' },
          }),
        );
        return;
      }
      if (parsed.type === 'transcript:add') {
        logDebug(
          `Transcript websocket message room=${room.id} source=${parsed.payload.source} speaker=${socket.data.memberName} text="${compactLogText(parsed.payload.text)}"`,
        );
      }
      applyClientMessage(room, socket.data, parsed);
      if (parsed.type === 'transcript:add') {
        persistTranscriptContext(room.id, socket.data.memberName, parsed.payload.text);
        scheduleTranscriptPatch(room.id, room.transcriptChunks.length);
      }
      broadcastSnapshot(room.id);
    } catch {
      socket.send(
        JSON.stringify({
          type: 'room:error',
          payload: { message: 'Invalid websocket message payload.' },
        }),
      );
    }
  },
  close: (ws: any) => {
    detachSocket(ws as unknown as Parameters<typeof attachSocket>[0]);
  },
};

const isAddressInUseError = (error: unknown): boolean => {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string' &&
      (error as { code?: string }).code === 'EADDRINUSE',
  );
};

const startServerWithPortFallback = () => {
  for (let offset = 0; offset < PORT_SCAN_SPAN; offset += 1) {
    const port = PREFERRED_PORT + offset;
    try {
      Bun.serve<SocketData>({
        port,
        fetch: fetchHandler,
        websocket: websocketHandler,
      });
      return port;
    } catch (error) {
      if (isAddressInUseError(error)) {
        continue;
      }
      throw error;
    }
  }

  const endPort = PREFERRED_PORT + PORT_SCAN_SPAN - 1;
  throw new Error(`No available port found in range ${PREFERRED_PORT}-${endPort}`);
};

export const startServer = () => {
  const runningPort = startServerWithPortFallback();
  if (runningPort !== PREFERRED_PORT) {
    console.warn(
      `Port ${PREFERRED_PORT} is busy, using ${runningPort}. Client will auto-discover within ports ${PREFERRED_PORT}-${PREFERRED_PORT + PORT_SCAN_SPAN - 1}.`,
    );
  }
  if (runtimeConfig.sourcePath) {
    console.log(`Loaded SenseBoard config: ${runtimeConfig.sourcePath}`);
  }
  console.log(`SenseBoard server listening on http://localhost:${runningPort}`);
  console.log(`Using transcribing only AI provider: ${getTranscriptionProviderLabel()}`);
  console.log(`Using main AI provider: ${getAiProviderLabel()}`);
  console.log(`Personalization store: sqlite (${getPersonalizationStorePath()})`);
  if (TRANSCRIPTION_CHUNK_CAPTURE_ENABLED) {
    console.log(`Transcription chunk capture: enabled (${TRANSCRIPTION_CHUNK_CAPTURE_DIR})`);
  } else {
    console.log('Transcription chunk capture: disabled');
  }
  if (TRANSCRIPT_TEXT_ARCHIVE_ENABLED) {
    console.log(`Transcript text archive: enabled (${TRANSCRIPT_TEXT_ARCHIVE_DIR})`);
  } else {
    console.log('Transcript text archive: disabled (memory-only mode)');
  }
  void primeAiPromptSession()
    .then(() => {
      logDebug('Main AI prompt session primed.');
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logDebug(`Main AI prompt session prime skipped/failed error="${compactLogText(detail)}"`);
    });
  return runningPort;
};

export const __resetAiQueueForTests = () => {
  aiQueueByRoom.clear();
  personalAiQueueByKey.clear();
  personalBoardStateByRoom.clear();
  for (const deferred of deferredPersonalAiByRoom.values()) {
    clearTimeout(deferred.timer);
  }
  deferredPersonalAiByRoom.clear();
  lastStoredTranscriptBySpeaker.clear();
  aiLastActivityByRoom.clear();
  for (const timer of aiIdleTimerByRoom.values()) {
    clearTimeout(timer);
  }
  aiIdleTimerByRoom.clear();
};

if (import.meta.main) {
  startServer();
}
