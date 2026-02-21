import { afterEach, describe, expect, it, mock } from 'bun:test';

type ServerModule = typeof import('./server');

interface AiMockOverrides {
  createSystemPromptPayloadPreview?: () => unknown;
  generateBoardOps?: () => Promise<{ ops: unknown[]; fingerprint: string }>;
  hasAiSignal?: () => boolean;
  runAiPreflightCheck?: () => Promise<{ ok: boolean }>;
}

const loadServerModule = async (overrides: AiMockOverrides = {}): Promise<ServerModule> => {
  mock.restore();

  mock.module('./runtime-config', () => ({
    getRuntimeConfig: () => ({
      ai: {
        provider: 'deterministic',
        openaiModel: 'gpt-4.1-mini',
        codexModel: 'gpt-5-codex',
        openaiApiKey: '',
        review: {
          maxRevisions: 20,
          confidenceThreshold: 0.98,
        },
      },
      server: {
        port: 8787,
        portScanSpan: 8,
      },
      sourcePath: null,
    }),
  }));

  mock.module('./ai-engine', () => ({
    createSystemPromptPayloadPreview: overrides.createSystemPromptPayloadPreview ?? (() => ({ preview: 'ok' })),
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
    getAiProviderLabel: () => 'mock-provider',
    hasAiSignal: overrides.hasAiSignal ?? (() => true),
    runAiPreflightCheck: overrides.runAiPreflightCheck ?? (async () => ({ ok: true })),
  }));

  return (await import(`./server.ts?test=${Date.now()}-${Math.random()}`)) as ServerModule;
};

afterEach(() => {
  mock.restore();
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

  it('returns prompt preview payload from mocked AI prompt builder', async () => {
    const server = await loadServerModule({
      createSystemPromptPayloadPreview: () => ({
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    });

    const response = await server.fetchHandler(new Request('http://localhost/rooms/prompt1/prompt-preview', { method: 'GET' }), {
      upgrade: () => false,
    });
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload).toEqual({
      systemPrompt: 'system',
      userPrompt: 'user',
    });
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
