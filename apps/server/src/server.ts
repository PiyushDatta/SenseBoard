import { applyBoardOps } from '../../shared/board-state';
import { generateBoardOps, getAiProviderLabel, hasAiSignal, runAiPreflightCheck } from './ai-engine';
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
import { getRuntimeConfig } from './runtime-config';
import { getTranscriptionProviderLabel, transcribeAudioBlob } from './transcription';
import type { ClientMessage, TriggerPatchRequest } from '../../shared/types';

const runtimeConfig = getRuntimeConfig();
const PREFERRED_PORT = runtimeConfig.server.port;
const PORT_SCAN_SPAN = runtimeConfig.server.portScanSpan;
const LOG_LEVEL = runtimeConfig.logging?.level ?? 'debug';

interface SocketData {
  roomId: string;
  memberId: string;
  memberName: string;
}

interface AiPatchJob {
  request: TriggerPatchRequest;
  resolve: (value: { applied: boolean; reason?: string; patch?: unknown }) => void;
}

interface AiQueueState {
  running: boolean;
  jobs: AiPatchJob[];
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
const AI_TRANSCRIPT_DEBOUNCE_MS = 500;
const aiQueueByRoom = new Map<string, AiQueueState>();
const transcriptDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

const runAiPatchRequest = async (
  roomId: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string; patch?: unknown }> => {
  const room = getOrCreateRoom(roomId);
  const reason = request.reason ?? 'manual';
  const regenerate = Boolean(request.regenerate);
  const windowSeconds = request.windowSeconds ?? 30;

  if (room.aiConfig.frozen && !regenerate) {
    return { applied: false, reason: 'frozen' };
  }

  if (!regenerate) {
    const waitMs = Math.max(0, AI_MIN_INTERVAL_MS - (Date.now() - room.lastAiPatchAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  if (reason === 'tick' && !hasAiSignal(room, windowSeconds)) {
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
    return { applied: false, reason: 'no_signal' };
  }

  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'updating';
  const boardOpsResult = await generateBoardOps(room, {
    reason,
    regenerate,
    windowSeconds,
  }).catch(() => null);

  if (!boardOpsResult || boardOpsResult.ops.length === 0) {
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
    return { applied: false, reason: 'ai_no_response' };
  }

  if (!regenerate && reason === 'tick' && boardOpsResult.fingerprint === room.lastAiFingerprint) {
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
    return { applied: false, reason: 'no_change' };
  }

  room.board = applyBoardOps(room.board, boardOpsResult.ops);
  room.lastAiPatchAt = Date.now();
  room.lastAiFingerprint = boardOpsResult.fingerprint;
  room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
  broadcastSnapshot(room.id);
  return { applied: true, patch: { kind: 'board_ops', ops: boardOpsResult.ops } };
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

const enqueueAiPatch = (
  roomId: string,
  request: TriggerPatchRequest,
): Promise<{ applied: boolean; reason?: string; patch?: unknown }> => {
  const queueState = getQueueState(roomId);
  if (request.reason === 'tick' && !request.regenerate) {
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

const scheduleTranscriptPatch = (roomId: string) => {
  const existing = transcriptDebounceTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    transcriptDebounceTimers.delete(roomId);
    const room = getOrCreateRoom(roomId);
    if (room.aiConfig.frozen) {
      return;
    }
    void enqueueAiPatch(roomId, {
      reason: 'tick',
      windowSeconds: 30,
    });
  }, AI_TRANSCRIPT_DEBOUNCE_MS);
  transcriptDebounceTimers.set(roomId, timer);
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
      const memberName = url.searchParams.get('name') ?? 'Guest';
      if (!roomId) {
        return json({ error: 'roomId is required' }, 400);
      }
      const data = createSocketData(roomId, memberName);
      const upgraded = server.upgrade(request, { data });
      if (!upgraded) {
        return json({ error: 'websocket upgrade failed' }, 500);
      }
      return undefined;
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', now: new Date().toISOString() });
    }

    if (url.pathname === '/ai/preflight' && request.method === 'GET') {
      const result = await runAiPreflightCheck();
      return json(result, result.ok ? 200 : 503);
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
        return json({ ok: false, error: 'audio file is required' }, 400);
      }

      const transcription = await transcribeAudioBlob(audioValue);
      if (!transcription.ok) {
        return json(transcription, 503);
      }

      const text = transcription.text.trim();
      if (!text) {
        logDebug(
          `Transcription returned empty text room=${roomId} speaker=${speaker} provider=${transcription.provider ?? 'unknown'}`,
        );
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

      scheduleTranscriptPatch(room.id);
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
      applyClientMessage(room, socket.data, parsed);
      if (parsed.type === 'transcript:add') {
        scheduleTranscriptPatch(room.id);
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
  return runningPort;
};

export const __resetAiQueueForTests = () => {
  aiQueueByRoom.clear();
  transcriptDebounceTimers.forEach((timer) => clearTimeout(timer));
  transcriptDebounceTimers.clear();
};

if (import.meta.main) {
  startServer();
}
