import { applyDiagramPatch } from './diagram-engine';
import { createSystemPromptPayloadPreview, generateDiagramPatch, getAiProviderLabel, hasAiSignal } from './ai-engine';
import {
  applyClientMessage,
  attachSocket,
  broadcastSnapshot,
  createRoom,
  createSocketData,
  detachSocket,
  getOrCreateRoom,
} from './store';
import { getRuntimeConfig } from './runtime-config';
import type { ClientMessage, TriggerPatchRequest } from '../../shared/types';

const runtimeConfig = getRuntimeConfig();
const PREFERRED_PORT = runtimeConfig.server.port;
const PORT_SCAN_SPAN = runtimeConfig.server.portScanSpan;

interface SocketData {
  roomId: string;
  memberId: string;
  memberName: string;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

const fetchHandler = async (
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

    if (pathParts[0] === 'rooms' && pathParts[2] === 'prompt-preview' && request.method === 'GET') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const room = getOrCreateRoom(roomId);
      return json(createSystemPromptPayloadPreview(room, { reason: 'manual' }));
    }

    if (pathParts[0] === 'rooms' && pathParts[2] === 'ai-patch' && request.method === 'POST') {
      const roomId = parseRoomId(url);
      if (!roomId) {
        return json({ error: 'invalid room path' }, 400);
      }
      const room = getOrCreateRoom(roomId);
      const payload = (await request.json().catch(() => ({}))) as Partial<TriggerPatchRequest>;
      const reason = payload.reason ?? 'manual';
      const regenerate = Boolean(payload.regenerate);
      const windowSeconds = payload.windowSeconds ?? 30;
      const now = Date.now();

      if (room.aiConfig.frozen && !regenerate) {
        return json({ applied: false, reason: 'frozen' });
      }

      const minIntervalMs = 2000;
      if (!regenerate && now - room.lastAiPatchAt < minIntervalMs) {
        return json({ applied: false, reason: 'rate_limited' });
      }

      if (reason === 'tick' && !hasAiSignal(room, windowSeconds)) {
        room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
        return json({ applied: false, reason: 'no_signal' });
      }

      room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'updating';
      const { patch, fingerprint } = await generateDiagramPatch(room, {
        reason,
        regenerate,
        windowSeconds,
      });

      if (!regenerate && reason === 'tick' && fingerprint === room.lastAiFingerprint) {
        room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'idle';
        return json({ applied: false, reason: 'no_change' });
      }

      const applied = applyDiagramPatch(room, patch, { regenerate });
      if (applied) {
        room.lastAiFingerprint = fingerprint;
        broadcastSnapshot(room.id);
      }

      return json({ applied, patch });
    }

    return json({ error: 'not_found' }, 404);
};

const websocketHandler = {
  open: (ws: any) => {
    attachSocket(ws as unknown as Parameters<typeof attachSocket>[0]);
  },
  message: (ws: any, message: unknown) => {
    const socket = ws as unknown as Parameters<typeof attachSocket>[0];
    try {
      const parsed = JSON.parse(String(message)) as ClientMessage;
      const room = getOrCreateRoom(socket.data.roomId);
      applyClientMessage(room, socket.data, parsed);
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

const runningPort = startServerWithPortFallback();
if (runningPort !== PREFERRED_PORT) {
  console.warn(
    `Port ${PREFERRED_PORT} is busy, using ${runningPort}. Client will auto-discover within ports ${PREFERRED_PORT}-${PREFERRED_PORT + PORT_SCAN_SPAN - 1}.`,
  );
}
if (runtimeConfig.sourcePath) {
  console.log(`Loaded SenseBoard config: ${runtimeConfig.sourcePath}`);
}
console.log(`SenseBoard server listening on http://localhost:${runningPort} (AI provider: ${getAiProviderLabel()})`);
