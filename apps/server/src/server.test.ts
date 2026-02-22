import { afterEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type ServerModule = typeof import('./server');

interface AiMockOverrides {
  generateBoardOps?: () => Promise<{ ops: unknown[]; fingerprint: string }>;
  generateDiagramPatch?: () => Promise<{
    patch: {
      topic: string;
      diagramType: 'flowchart' | 'system_blocks' | 'tree';
      confidence: number;
      actions: Array<
        | {
            op: 'upsertNode';
            id: string;
            label: string;
            x: number;
            y: number;
          }
        | {
            op: 'setTitle';
            text: string;
          }
      >;
      openQuestions: string[];
      conflicts: Array<{ type: 'topic' | 'context' | 'correction'; detail: string }>;
    };
    fingerprint: string;
  }>;
  hasAiSignal?: () => boolean;
  runAiPreflightCheck?: () => Promise<{ ok: boolean }>;
  transcribeAudioBlob?: () => Promise<{ ok: boolean; text: string; error?: string }>;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  preflightEnabled?: boolean;
  captureConfig?: {
    enabled: boolean;
    directory: string | null;
  };
}

const tempDirs = new Set<string>();

const loadServerModule = async (overrides: AiMockOverrides = {}): Promise<ServerModule> => {
  mock.restore();

  mock.module('./runtime-config', () => ({
    getRuntimeConfig: () => ({
      ai: {
        provider: 'deterministic',
        openaiModel: 'gpt-4.1-mini',
        openaiTranscriptionModel: 'whisper-1',
        anthropicModel: 'claude-3-5-sonnet-20241022',
        codexModel: 'gpt-5-codex',
        openaiApiKey: '',
        anthropicApiKey: '',
        review: {
          maxRevisions: 20,
          confidenceThreshold: 0.98,
        },
      },
      server: {
        port: 8787,
        portScanSpan: 8,
      },
      logging: {
        level: overrides.logLevel ?? 'debug',
      },
      preflight: {
        enabled: overrides.preflightEnabled ?? true,
      },
      capture: {
        transcriptionChunks: {
          enabled: overrides.captureConfig?.enabled ?? false,
          directory: overrides.captureConfig?.directory ?? null,
        },
      },
      sourcePath: null,
    }),
  }));

  mock.module('./ai-engine', () => ({
    collectAiInput: () => ({
      transcriptWindow: [],
    }),
    generateDiagramPatch:
      overrides.generateDiagramPatch ??
      (async () => ({
        patch: {
          topic: 'Mock Diagram',
          diagramType: 'flowchart',
          confidence: 0.7,
          actions: [
            {
              op: 'upsertNode',
              id: 'N1',
              label: 'Mock Node',
              x: 120,
              y: 120,
            },
            {
              op: 'setTitle',
              text: 'Mock Diagram',
            },
          ],
          openQuestions: [],
          conflicts: [],
        },
        fingerprint: 'fp-mock-diagram',
      })),
    generateBoardOps:
      overrides.generateBoardOps ??
      (async () => ({
        ops: [
          {
            type: 'upsertElement',
            element: {
              id: 'ai-shape',
              kind: 'rect',
              x: 20,
              y: 20,
              w: 120,
              h: 80,
              createdAt: Date.now(),
              createdBy: 'ai',
            },
          },
        ],
        fingerprint: 'fp-default',
      })),
    generatePersonalizedBoardOps: async () => ({
      ops: [
        {
          type: 'upsertElement',
          element: {
            id: 'personal-shape',
            kind: 'text',
            x: 10,
            y: 10,
            text: '- personalized',
            createdAt: Date.now(),
            createdBy: 'ai',
          },
        },
      ],
      fingerprint: 'fp-personal-default',
    }),
    getAiProviderLabel: () => 'mock-provider',
    hasAiSignal: overrides.hasAiSignal ?? (() => true),
    primeAiPromptSession: async () => undefined,
    runAiPreflightCheck: overrides.runAiPreflightCheck ?? (async () => ({ ok: true })),
  }));

  mock.module('./personalization-store', () => ({
    getPersonalizationStorePath: () => '.tmp/test-personalization.sqlite',
    getPersonalizationProfile: (name: string) => ({
      nameKey: name.trim().toLowerCase(),
      displayName: name.trim() || 'Guest',
      contextLines: [],
      updatedAt: Date.now(),
    }),
    appendPersonalizationContext: (name: string, text: string) => ({
      nameKey: name.trim().toLowerCase(),
      displayName: name.trim() || 'Guest',
      contextLines: [text.trim()],
      updatedAt: Date.now(),
    }),
    getPersonalizationPromptLines: () => [],
  }));

  mock.module('./transcription', () => ({
    transcribeAudioBlob:
      overrides.transcribeAudioBlob ??
      (async () => ({
        ok: true,
        text: 'mock transcript',
      })),
    getTranscriptionProviderLabel: () => 'mock-transcription-provider',
  }));

  return (await import(`./server.ts?test=${Date.now()}-${Math.random()}`)) as ServerModule;
};

afterEach(() => {
  mock.restore();
  for (const dirPath of tempDirs) {
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
  tempDirs.clear();
});

describe('server fetchHandler', () => {
  it('handles CORS preflight and health checks', async () => {
    const server = await loadServerModule();

    const optionsResponse = await server.fetchHandler(new Request('http://localhost/rooms', { method: 'OPTIONS' }), {
      upgrade: () => false,
    });
    expect(optionsResponse?.status).toBe(204);

    const healthResponse = await server.fetchHandler(new Request('http://localhost/health', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(healthResponse?.status).toBe(200);
    const health = await healthResponse?.json();
    expect(health?.status).toBe('ok');
    expect(typeof health?.now).toBe('string');
  });

  it('creates and fetches rooms through REST routes', async () => {
    const server = await loadServerModule();

    const createdResponse = await server.fetchHandler(new Request('http://localhost/rooms', { method: 'POST' }), {
      upgrade: () => false,
    });
    expect(createdResponse?.status).toBe(200);
    const created = await createdResponse?.json();
    expect(typeof created?.roomId).toBe('string');
    expect(created?.room?.id).toBe(created?.roomId);

    const roomResponse = await server.fetchHandler(
      new Request(`http://localhost/rooms/${created?.roomId?.toLowerCase()}`, { method: 'GET' }),
      {
        upgrade: () => false,
      },
    );
    expect(roomResponse?.status).toBe(200);
    const roomPayload = await roomResponse?.json();
    expect(roomPayload?.room?.id).toBe(created?.roomId);
  });

  it('manages personalization context and personal board endpoints', async () => {
    const server = await loadServerModule();

    const addResponse = await server.fetchHandler(
      new Request('http://localhost/personalization/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alex', text: 'Prefers concise bullet points.' }),
      }),
      {
        upgrade: () => false,
      },
    );
    expect(addResponse?.status).toBe(200);

    const getResponse = await server.fetchHandler(new Request('http://localhost/personalization/context?name=Alex', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(getResponse?.status).toBe(200);
    const profilePayload = await getResponse?.json();
    expect(profilePayload?.profile?.displayName).toBe('Alex');

    const personalBoardResponse = await server.fetchHandler(
      new Request('http://localhost/rooms/ROOM-PERSONAL/personal-board?name=Alex', { method: 'GET' }),
      {
        upgrade: () => false,
      },
    );
    expect(personalBoardResponse?.status).toBe(200);
    const boardPayload = await personalBoardResponse?.json();
    expect(boardPayload?.board).toBeDefined();
  });

  it('runs AI preflight and maps non-ok to 503', async () => {
    const healthyServer = await loadServerModule({
      runAiPreflightCheck: async () => ({ ok: true }),
    });
    const okResponse = await healthyServer.fetchHandler(new Request('http://localhost/ai/preflight', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(okResponse?.status).toBe(200);

    const unhealthyServer = await loadServerModule({
      runAiPreflightCheck: async () => ({ ok: false }),
    });
    const failResponse = await unhealthyServer.fetchHandler(new Request('http://localhost/ai/preflight', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(failResponse?.status).toBe(503);
    const payload = await failResponse?.json();
    expect(payload?.ok).toBe(false);
  });

  it('handles websocket upgrade success and failure cases', async () => {
    const server = await loadServerModule();
    let upgradedData: unknown = null;

    const missingRoom = await server.fetchHandler(new Request('http://localhost/ws?name=Alex', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(missingRoom?.status).toBe(400);

    const failedUpgrade = await server.fetchHandler(new Request('http://localhost/ws?roomId=roomx&name=Alex', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(failedUpgrade?.status).toBe(500);

    const missingName = await server.fetchHandler(new Request('http://localhost/ws?roomId=roomx', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(missingName?.status).toBe(400);

    const upgraded = await server.fetchHandler(new Request('http://localhost/ws?roomId=roomx&name=Alex', { method: 'GET' }), {
      upgrade: (_request: Request, options: unknown) => {
        upgradedData = options;
        return true;
      },
    });
    expect(upgraded).toBeUndefined();
    expect(upgradedData).toMatchObject({
      data: {
        roomId: 'ROOMX',
        memberName: 'Alex',
      },
    });
  });

  it('triggers AI patch endpoint with mocked board ops response', async () => {
    const server = await loadServerModule({
      generateBoardOps: async () => ({
        ops: [
          {
            type: 'upsertElement',
            element: {
              id: 'ai-shape-x',
              kind: 'rect',
              x: 1,
              y: 2,
              w: 30,
              h: 40,
              createdAt: Date.now(),
              createdBy: 'ai',
            },
          },
        ],
        fingerprint: 'fp-room-1',
      }),
    });

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-1/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual' }),
      }),
      {
        upgrade: () => false,
      },
    );
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toMatchObject({
      applied: true,
      patch: {
        kind: 'board_ops',
      },
    });
  });

  it('stacks prior AI board layers by pushing old generations downward', async () => {
    let generation = 0;
    const server = await loadServerModule({
      generateBoardOps: async () => {
        generation += 1;
        return {
          ops: [
            {
              type: 'upsertElement',
              element: {
                id: 'shape-stack',
                kind: 'rect',
                x: 100,
                y: 120,
                w: 220,
                h: 120,
                createdAt: Date.now(),
                createdBy: 'ai',
              },
            },
          ],
          fingerprint: `fp-stack-${generation}`,
        };
      },
    });

    await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-stack/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual', regenerate: true }),
      }),
      {
        upgrade: () => false,
      },
    );
    await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-stack/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual', regenerate: true }),
      }),
      {
        upgrade: () => false,
      },
    );

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AI-STACK', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        board: {
          order: string[];
          elements: Record<string, { kind: string; y?: number }>;
        };
      };
    };

    const ids = roomPayload.room.board.order.filter((id) => id.includes(':shape-stack'));
    expect(ids.length).toBe(2);
    const ys = ids
      .map((id) => roomPayload.room.board.elements[id]?.y)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right);

    expect(ys).toEqual([120, 640]);
  });

  it('drops oldest stacked AI layers when they cross the board boundary', async () => {
    let generation = 0;
    const server = await loadServerModule({
      generateBoardOps: async () => {
        generation += 1;
        return {
          ops: [
            {
              type: 'upsertElement',
              element: {
                id: 'shape-ring',
                kind: 'rect',
                x: 140,
                y: 120,
                w: 180,
                h: 100,
                createdAt: Date.now(),
                createdBy: 'ai',
              },
            },
          ],
          fingerprint: `fp-ring-${generation}`,
        };
      },
    });

    for (let index = 0; index < 14; index += 1) {
      const response = await server.fetchHandler(
        new Request('http://localhost/rooms/room-ai-ring/ai-patch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'manual', regenerate: true }),
        }),
        {
          upgrade: () => false,
        },
      );
      expect(response?.status).toBe(200);
    }

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AI-RING', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        board: {
          order: string[];
          elements: Record<string, { kind: string; y?: number }>;
        };
      };
    };

    const ids = roomPayload.room.board.order.filter((id) => id.includes(':shape-ring'));
    expect(ids.length).toBeLessThan(14);
    expect(ids.length).toBeGreaterThan(0);

    const ys = ids
      .map((id) => roomPayload.room.board.elements[id]?.y)
      .filter((value): value is number => typeof value === 'number');
    expect(Math.min(...ys)).toBe(120);
    expect(Math.max(...ys)).toBeLessThanOrEqual(5600);
  });

  it('returns no_signal for tick patch when mocked AI signal is absent', async () => {
    const server = await loadServerModule({
      hasAiSignal: () => false,
    });

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-2/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'tick' }),
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toEqual({
      applied: false,
      reason: 'no_signal',
    });
  });

  it('falls back to diagram patch when board ops are non-visual only', async () => {
    const server = await loadServerModule({
      generateBoardOps: async () => ({
        ops: [{ type: 'clearBoard' }],
        fingerprint: 'fp-clear-only',
      }),
      generateDiagramPatch: async () => ({
        patch: {
          topic: 'Tree discussion',
          diagramType: 'tree',
          confidence: 0.92,
          actions: [
            {
              op: 'upsertNode',
              id: 'A',
              label: 'A',
              x: 120,
              y: 120,
            },
            {
              op: 'setTitle',
              text: 'Tree discussion',
            },
          ],
          openQuestions: [],
          conflicts: [],
        },
        fingerprint: 'fp-diagram-fallback',
      }),
    });

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-fallback/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual' }),
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toMatchObject({
      applied: true,
      patch: {
        kind: 'diagram_patch',
      },
    });

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AI-FALLBACK', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        board: {
          order: string[];
        };
      };
    };
    expect(roomPayload.room.board.order.length).toBeGreaterThan(0);
  });

  it('falls back to diagram patch when board ops are invalid and produce no board mutation', async () => {
    const server = await loadServerModule({
      generateBoardOps: async () => ({
        ops: [
          {
            type: 'upsertElement',
            element: {
              id: 'invalid-shape',
              kind: 'not-a-real-kind',
              createdAt: Date.now(),
              createdBy: 'ai',
            } as any,
          },
        ],
        fingerprint: 'fp-invalid-board-ops',
      }),
      generateDiagramPatch: async () => ({
        patch: {
          topic: 'Recovered diagram',
          diagramType: 'flowchart',
          confidence: 0.85,
          actions: [
            {
              op: 'upsertNode',
              id: 'recover-1',
              label: 'Recovered Node',
              x: 140,
              y: 120,
            },
            {
              op: 'setTitle',
              text: 'Recovered diagram',
            },
          ],
          openQuestions: [],
          conflicts: [],
        },
        fingerprint: 'fp-diagram-recovered',
      }),
    });

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-ai-invalid-ops/ai-patch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'manual' }),
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toMatchObject({
      applied: true,
      patch: {
        kind: 'diagram_patch',
      },
    });

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AI-INVALID-OPS', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        board: {
          order: string[];
        };
      };
    };
    expect(roomPayload.room.board.order.length).toBeGreaterThan(0);
  });

  it('accepts multipart audio transcription and appends transcript to room state', async () => {
    const server = await loadServerModule({
      transcribeAudioBlob: async () => ({
        ok: true,
        text: 'Root A has children B and C',
      }),
    });

    const form = new FormData();
    form.append('speaker', 'Host');
    form.append('audio', new File([new Uint8Array(2048).fill(7)], 'chunk.webm', { type: 'audio/webm' }));

    const transcribeResponse = await server.fetchHandler(
      new Request('http://localhost/rooms/room-audio-1/transcribe', {
        method: 'POST',
        body: form,
      }),
      {
        upgrade: () => false,
      },
    );

    expect(transcribeResponse?.status).toBe(200);
    const transcribePayload = await transcribeResponse?.json();
    expect(transcribePayload).toMatchObject({
      ok: true,
      accepted: true,
      text: 'Root A has children B and C',
    });

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AUDIO-1', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        transcriptChunks: Array<{ speaker: string; text: string; source: string }>;
      };
    };
    expect(roomPayload.room.transcriptChunks.length).toBe(1);
    expect(roomPayload.room.transcriptChunks[0]).toMatchObject({
      speaker: 'Host',
      text: 'Root A has children B and C',
      source: 'mic',
    });

    server.__resetAiQueueForTests();
  });

  it('captures raw audio chunks when capture is enabled', async () => {
    const captureDir = mkdtempSync(join(tmpdir(), 'senseboard-chunk-capture-test-'));
    tempDirs.add(captureDir);

    const server = await loadServerModule({
      captureConfig: {
        enabled: true,
        directory: captureDir,
      },
      transcribeAudioBlob: async () => ({
        ok: true,
        text: 'captured transcript',
      }),
    });

    const form = new FormData();
    form.append('speaker', 'Host');
    form.append('audio', new File([new Uint8Array(2048).fill(9)], 'chunk.webm', { type: 'audio/webm' }));

    const transcribeResponse = await server.fetchHandler(
      new Request('http://localhost/rooms/room-audio-capture/transcribe', {
        method: 'POST',
        body: form,
      }),
      {
        upgrade: () => false,
      },
    );

    expect(transcribeResponse?.status).toBe(200);
    const files = readdirSync(captureDir);
    expect(files.length).toBe(1);
    expect(files[0]?.endsWith('.webm')).toBe(true);

    server.__resetAiQueueForTests();
  });

  it('returns 400 on transcribe endpoint when audio file is missing', async () => {
    const server = await loadServerModule();
    const form = new FormData();
    form.append('speaker', 'Host');

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-audio-2/transcribe', {
        method: 'POST',
        body: form,
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(400);
    const payload = await response?.json();
    expect(payload).toEqual({
      ok: false,
      error: 'audio file is required',
    });
  });

  it('skips transcription when audio chunk is too small', async () => {
    const server = await loadServerModule();
    const form = new FormData();
    form.append('speaker', 'Host');
    form.append('audio', new File(['x'], 'tiny.webm', { type: 'audio/webm' }));

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-audio-small/transcribe', {
        method: 'POST',
        body: form,
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toEqual({
      ok: true,
      text: '',
      accepted: false,
      reason: 'audio_too_small',
    });
  });

  it('skips AI enqueue when transcription returns empty text', async () => {
    const server = await loadServerModule({
      transcribeAudioBlob: async () => ({
        ok: true,
        text: '   ',
      }),
    });
    const form = new FormData();
    form.append('speaker', 'Host');
    form.append('audio', new File([new Uint8Array(2048).fill(3)], 'empty.webm', { type: 'audio/webm' }));

    const response = await server.fetchHandler(
      new Request('http://localhost/rooms/room-audio-empty/transcribe', {
        method: 'POST',
        body: form,
      }),
      {
        upgrade: () => false,
      },
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toEqual({
      ok: true,
      text: '',
      accepted: false,
      reason: 'empty_transcript',
    });

    const roomResponse = await server.fetchHandler(new Request('http://localhost/rooms/ROOM-AUDIO-EMPTY', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(roomResponse?.status).toBe(200);
    const roomPayload = (await roomResponse?.json()) as {
      room: {
        transcriptChunks: Array<{ text: string }>;
      };
    };
    expect(roomPayload.room.transcriptChunks.length).toBe(0);
  });

  it('returns 404 for unknown routes', async () => {
    const server = await loadServerModule();
    const response = await server.fetchHandler(new Request('http://localhost/nope', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({ error: 'not_found' });
  });
});

describe('server websocketHandler', () => {
  it('opens socket, applies valid messages, and emits snapshots', async () => {
    const server = await loadServerModule();
    const sent: string[] = [];
    const ws = {
      data: {
        roomId: 'ROOM-WS-A',
        memberId: 'u-1',
        memberName: 'Alex',
      },
      send: (value: string) => {
        sent.push(value);
      },
    };

    server.websocketHandler.open(ws);
    sent.length = 0;
    server.websocketHandler.message(
      ws,
      JSON.stringify({
        type: 'client:ack',
        payload: {
          protocol: 'senseboard-ws-v1',
          sentAt: Date.now(),
        },
      }),
    );
    const ackPayload = JSON.parse(sent.at(-1) ?? '{}') as { type: string };
    expect(ackPayload.type).toBe('server:ack');
    sent.length = 0;

    server.websocketHandler.message(
      ws,
      JSON.stringify({
        type: 'chat:add',
        payload: {
          text: 'Hello',
          kind: 'normal',
        },
      }),
    );

    const snapshot = JSON.parse(sent.at(-1) ?? '{}') as {
      type: string;
      payload: { chatMessages: Array<{ text: string }> };
    };
    expect(snapshot.type).toBe('room:snapshot');
    expect(snapshot.payload.chatMessages.at(-1)?.text).toBe('Hello');
  });

  it('responds with room:error on invalid websocket payload', async () => {
    const server = await loadServerModule();
    const sent: string[] = [];
    const ws = {
      data: {
        roomId: 'ROOM-WS-B',
        memberId: 'u-2',
        memberName: 'Sam',
      },
      send: (value: string) => {
        sent.push(value);
      },
    };

    server.websocketHandler.open(ws);
    sent.length = 0;
    server.websocketHandler.message(ws, '{invalid-json');

    expect(sent.length).toBe(1);
    const payload = JSON.parse(sent[0] ?? '{}') as { type: string; payload: { message: string } };
    expect(payload.type).toBe('room:error');
    expect(payload.payload.message).toContain('Invalid websocket message');
  });

  it('queues an AI patch after transcript chunks arrive over websocket', async () => {
    let aiCallCount = 0;
    const server = await loadServerModule({
      generateBoardOps: async () => {
        aiCallCount += 1;
        return {
          ops: [
            {
              type: 'upsertElement',
              element: {
                id: `ai-transcript-${aiCallCount}`,
                kind: 'rect',
                x: 12,
                y: 24,
                w: 160,
                h: 90,
                createdAt: Date.now(),
                createdBy: 'ai',
              },
            },
          ],
          fingerprint: `fp-transcript-${aiCallCount}`,
        };
      },
    });

    const sent: string[] = [];
    const ws = {
      data: {
        roomId: 'ROOM-WS-TX',
        memberId: 'u-3',
        memberName: 'Taylor',
      },
      send: (value: string) => {
        sent.push(value);
      },
    };

    server.websocketHandler.open(ws);
    sent.length = 0;
    server.websocketHandler.message(
      ws,
      JSON.stringify({
        type: 'client:ack',
        payload: {
          protocol: 'senseboard-ws-v1',
          sentAt: Date.now(),
        },
      }),
    );
    sent.length = 0;

    server.websocketHandler.message(
      ws,
      JSON.stringify({
        type: 'transcript:add',
        payload: {
          text: 'We have a tree with root A and children B and C.',
          source: 'mic',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 850));

    expect(aiCallCount).toBe(1);
    const latestSnapshot = JSON.parse(sent.at(-1) ?? '{}') as {
      type: string;
      payload: { transcriptChunks: Array<{ text: string }> };
    };
    expect(latestSnapshot.type).toBe('room:snapshot');
    expect(latestSnapshot.payload.transcriptChunks.at(-1)?.text).toContain('root A');

    server.__resetAiQueueForTests();
  });

  it('detaches sockets on close and broadcasts updated membership', async () => {
    const server = await loadServerModule();
    const oneSent: string[] = [];
    const twoSent: string[] = [];

    const one = {
      data: {
        roomId: 'ROOM-WS-C',
        memberId: 'u-1',
        memberName: 'Alex',
      },
      send: (value: string) => {
        oneSent.push(value);
      },
    };
    const two = {
      data: {
        roomId: 'ROOM-WS-C',
        memberId: 'u-2',
        memberName: 'Sam',
      },
      send: (value: string) => {
        twoSent.push(value);
      },
    };

    server.websocketHandler.open(one);
    server.websocketHandler.open(two);
    oneSent.length = 0;
    twoSent.length = 0;

    server.websocketHandler.close(one);
    expect(oneSent.length).toBe(0);
    expect(twoSent.length).toBe(1);

    const payload = JSON.parse(twoSent[0] ?? '{}') as {
      type: string;
      payload: {
        members: Array<{ id: string }>;
      };
    };
    expect(payload.type).toBe('room:snapshot');
    expect(payload.payload.members.map((member) => member.id)).toEqual(['u-2']);
  });
});
