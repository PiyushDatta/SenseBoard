import { applyBoardOps, createEmptyBoardState } from '../../shared/board-state';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  collectAiInput,
  generateBoardOps,
  generateDiagramPatch,
  generatePersonalizedBoardOps,
  getAiProviderLabel,
  hasAiSignal,
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
import type { BoardOp, BoardState, ClientMessage, TriggerPatchRequest } from '../../shared/types';

const runtimeConfig = getRuntimeConfig();
const PREFERRED_PORT = runtimeConfig.server.port;
const PORT_SCAN_SPAN = runtimeConfig.server.portScanSpan;
const LOG_LEVEL = runtimeConfig.logging?.level ?? 'debug';
const DEBUG_LOG_ENABLED = LOG_LEVEL === 'debug';
const TRANSCRIPTION_CHUNK_CAPTURE_ENABLED = runtimeConfig.capture?.transcriptionChunks?.enabled === true;
const TRANSCRIPTION_CHUNK_CAPTURE_DIR = runtimeConfig.capture?.transcriptionChunks?.directory
  ? resolve(runtimeConfig.capture.transcriptionChunks.directory)
  : join(tmpdir(), 'senseboard-transcribe-chunks');
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

const AI_MIN_INTERVAL_MS = 2000;
const AI_MAX_QUEUE_LENGTH = 120;
const PERSONAL_AI_MIN_INTERVAL_MS = 2500;
const PERSONAL_AI_MAX_QUEUE_LENGTH = 120;
const MAIN_QUEUE_WAIT_SLICE_MS = 80;
const MAIN_QUEUE_WAIT_TIMEOUT_MS = 6000;
const MIN_TRANSCRIBE_AUDIO_BYTES = 1024;
const aiQueueByRoom = new Map<string, AiQueueState>();
const personalBoardStateByRoom = new Map<string, Map<string, PersonalBoardState>>();
const personalAiQueueByKey = new Map<string, PersonalizedAiQueueState>();

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
    if (op.type === 'upsertElement' || op.type === 'appendStrokePoints') {
      return true;
    }
    if (op.type === 'batch') {
      return op.ops.some((nested) => hasRenderable(nested));
    }
    return false;
  };
  return ops.some((op) => hasRenderable(op));
};

const boardStateChanged = (before: BoardState, after: BoardState): boolean => {
  return after.revision !== before.revision;
};

const runAiPatchRequest = async (
  roomId: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string; patch?: unknown }> => {
  const room = getOrCreateRoom(roomId);
  const reason = request.reason ?? 'manual';
  const regenerate = Boolean(request.regenerate);
  const windowSeconds = request.windowSeconds ?? 30;
  const aiInputPreview = DEBUG_LOG_ENABLED
    ? collectAiInput(room, windowSeconds, {
        reason,
        regenerate,
        transcriptChunkCount: request.transcriptChunkCount,
      })
    : null;
  if (aiInputPreview) {
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

  if (reason === 'tick' && !hasAiSignal(room, windowSeconds)) {
    logDebug(`Main AI skipped room=${room.id} reason=no_signal`);
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
    return { applied: false, reason: 'no_signal' };
  }

  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'updating';
  const boardOpsResult = await generateBoardOps(room, {
    reason,
    regenerate,
    windowSeconds,
    transcriptChunkCount: request.transcriptChunkCount,
  }).catch(() => null);
  const boardAfterBoardOps = boardOpsResult ? applyBoardOps(room.board, boardOpsResult.ops) : null;
  const boardOpsMutatedBoard = boardAfterBoardOps ? boardStateChanged(room.board, boardAfterBoardOps) : false;

  const shouldFallbackToDiagramPatch =
    !boardOpsResult ||
    boardOpsResult.ops.length === 0 ||
    !boardOpsContainRenderableOutput(boardOpsResult.ops) ||
    !boardOpsMutatedBoard;

  if (shouldFallbackToDiagramPatch) {
    if (!boardOpsResult || boardOpsResult.ops.length === 0) {
      logDebug(`Main AI board-ops result room=${room.id} reason=ai_no_response fallback=diagram_patch`);
    } else if (!boardOpsMutatedBoard) {
      logDebug(
        `Main AI board-ops result room=${room.id} reason=no_effect ops=${boardOpsResult.ops.length} fallback=diagram_patch`,
      );
    } else {
      logDebug(
        `Main AI board-ops result room=${room.id} reason=non_visual_ops_only ops=${boardOpsResult.ops.length} fallback=diagram_patch`,
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
      room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
      return { applied: false, reason: 'ai_no_response' };
    }
    const applied = applyDiagramPatch(room, diagramPatchResult.patch, { regenerate });
    if (!applied) {
      logDebug(`Main AI fallback room=${room.id} reason=diagram_patch_not_applied`);
      room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
      return { applied: false, reason: 'ai_no_response' };
    }
    room.lastAiFingerprint = `${diagramPatchResult.fingerprint}:diagram_patch`;
    logDebug(
      `Main AI fallback applied room=${room.id} actions=${diagramPatchResult.patch.actions.length} fingerprint=${room.lastAiFingerprint}`,
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

  if (!regenerate && reason === 'tick' && boardOpsResult.fingerprint === room.lastAiFingerprint) {
    logDebug(`Main AI result room=${room.id} reason=no_change fingerprint=${boardOpsResult.fingerprint}`);
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
    return { applied: false, reason: 'no_change' };
  }

  room.board = boardAfterBoardOps;
  room.lastAiPatchAt = Date.now();
  room.lastAiFingerprint = boardOpsResult.fingerprint;
  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
  logDebug(
    `Main AI applied room=${room.id} ops=${boardOpsResult.ops.length} elements=${room.board.order.length} fingerprint=${boardOpsResult.fingerprint}`,
  );
  broadcastSnapshot(room.id);
  return { applied: true, patch: { kind: 'board_ops', ops: boardOpsResult.ops } };
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

  if (reason === 'tick' && !hasAiSignal(room, windowSeconds)) {
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
    logDebug(`Personal AI result room=${room.id} member=${normalizedMemberName} reason=ai_no_response`);
    return { applied: false, reason: 'ai_no_response' };
  }

  if (!regenerate && reason === 'tick' && result.fingerprint === personalBoardState.lastAiFingerprint) {
    logDebug(`Personal AI result room=${room.id} member=${normalizedMemberName} reason=no_change`);
    return { applied: false, reason: 'no_change' };
  }

  personalBoardState.board = applyBoardOps(personalBoardState.board, result.ops);
  personalBoardState.lastAiFingerprint = result.fingerprint;
  personalBoardState.lastAiPatchAt = Date.now();
  personalBoardState.updatedAt = Date.now();
  logDebug(
    `Personal AI applied room=${room.id} member=${normalizedMemberName} ops=${result.ops.length} fingerprint=${result.fingerprint}`,
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
  if (request.reason === 'tick' && !request.regenerate && request.transcriptChunkCount === undefined) {
    const pendingTick = queueState.jobs.some((job) => job.request.reason === 'tick' && !job.request.regenerate);
    if (pendingTick) {
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
  if (request.reason === 'tick' && !request.regenerate && request.transcriptChunkCount === undefined) {
    const pendingTick = queueState.jobs.some((job) => job.request.reason === 'tick' && !job.request.regenerate);
    if (pendingTick) {
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

const scheduleTranscriptPatch = (roomId: string, transcriptChunkCount?: number) => {
  const room = getOrCreateRoom(roomId);
  if (room.aiConfig.frozen) {
    logDebug(`Skip transcript AI patch room=${room.id} reason=frozen`);
    return;
  }
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
  void enqueueAiPatch(room.id, request);
  enqueuePersonalizedAiPatchForRoomMembers(room.id, request);
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
      const result = await enqueueAiPatch(roomId, {
        reason: payload.reason ?? 'manual',
        regenerate: Boolean(payload.regenerate),
        windowSeconds: payload.windowSeconds ?? 30,
      });
      enqueuePersonalizedAiPatchForRoomMembers(roomId, {
        reason: payload.reason ?? 'manual',
        regenerate: Boolean(payload.regenerate),
        windowSeconds: payload.windowSeconds ?? 30,
      });
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
};

if (import.meta.main) {
  startServer();
}
