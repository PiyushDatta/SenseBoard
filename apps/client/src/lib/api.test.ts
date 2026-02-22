/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from 'bun:test';

type ApiModule = typeof import('./api');

const API_BASE_URL = 'http://api.local:9001';

const loadApiModule = async (options?: {
  serverUrl?: string | null;
  serverPort?: string;
  serverPortSpan?: string;
  hostname?: string;
}): Promise<ApiModule> => {
  mock.restore();
  const port = Number(options?.serverPort ?? '8787');
  const span = Number(options?.serverPortSpan ?? '8');
  const normalizedSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 8;
  const serverCandidates =
    options?.serverUrl === null
      ? Array.from({ length: normalizedSpan }, (_, offset) => `http://localhost:${port + offset}`)
      : [options?.serverUrl ?? API_BASE_URL];

  mock.module('react-native', () => ({
    Platform: {
      OS: 'web',
    },
  }));
  mock.module('./config', () => ({
    SERVER_URL_CANDIDATES: serverCandidates,
    WS_URL_CANDIDATES: serverCandidates.map((url) => url.replace(/^http/i, 'ws')),
    SERVER_URL: serverCandidates[0] ?? API_BASE_URL,
  }));
  (globalThis as { window?: unknown }).window = {
    location: { hostname: options?.hostname ?? 'ignored-host' },
  } as unknown as Window;
  return (await import(`./api.ts?test=${Date.now()}-${Math.random()}`)) as ApiModule;
};

afterEach(() => {
  mock.restore();
  delete (globalThis as { window?: unknown }).window;
});

describe('api client', () => {
  it('createRoom sends POST request with JSON headers', async () => {
    const api = await loadApiModule();
    const calls: Array<{ url: string; method?: string; headers?: HeadersInit }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        headers: init?.headers,
      });
      return new Response(
        JSON.stringify({
          roomId: 'ROOM01',
          room: {
            id: 'ROOM01',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const payload = await api.createRoom();
      expect(payload.roomId).toBe('ROOM01');
      const appCalls = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCalls.length).toBe(1);
      expect(appCalls[0]?.url).toBe(`${API_BASE_URL}/rooms`);
      expect(appCalls[0]?.method).toBe('POST');
      expect(appCalls[0]?.headers).toEqual({ 'Content-Type': 'application/json' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uppercases room id and sends AI patch payload', async () => {
    const api = await loadApiModule();
    const calls: Array<{ url: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          room: {
            id: 'ROOM-XYZ',
          },
          applied: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const room = await api.getRoom('room-xyz');
      expect(room.id).toBe('ROOM-XYZ');
      const appCalls = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCalls[0]?.url.endsWith('/rooms/ROOM-XYZ')).toBe(true);

      await api.triggerAiPatch('room-xyz', { reason: 'manual', regenerate: true });
      const appCallsAfterPatch = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCallsAfterPatch[1]?.url.endsWith('/rooms/ROOM-XYZ/ai-patch')).toBe(true);
      expect(appCallsAfterPatch[1]?.body).toBe(JSON.stringify({ reason: 'manual', regenerate: true }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uploads audio chunk as multipart form-data for server transcription', async () => {
    const api = await loadApiModule();
    const calls: Array<{ url: string; body?: FormData }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body instanceof FormData ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          accepted: true,
          text: 'hello world',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const blob = new Blob(['audio-bytes'], { type: 'audio/webm' });
      const payload = await api.transcribeAudioChunk('room-xyz', 'Host', blob, 'audio/webm');
      expect(payload.ok).toBe(true);
      const appCalls = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCalls[0]?.url.endsWith('/rooms/ROOM-XYZ/transcribe')).toBe(true);
      expect(appCalls[0]?.body).toBeDefined();
      expect(appCalls[0]?.body?.get('speaker')).toBe('Host');
      const audio = appCalls[0]?.body?.get('audio');
      expect(audio instanceof File).toBe(true);
      expect((audio as File).name.endsWith('.webm')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('requests personalized board and personalization context endpoints', async () => {
    const api = await loadApiModule();
    const calls: Array<{ url: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          board: {
            elements: {},
            order: [],
            revision: 0,
            lastUpdatedAt: Date.now(),
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          updatedAt: Date.now(),
          ok: true,
          profile: {
            nameKey: 'alex',
            displayName: 'Alex',
            contextLines: ['Prefers bullet points'],
            updatedAt: Date.now(),
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      await api.getPersonalBoard('room-xyz', 'Alex');
      const appCalls = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCalls[0]?.url.endsWith('/rooms/ROOM-XYZ/personal-board?name=Alex')).toBe(true);

      await api.triggerPersonalBoardPatch('room-xyz', 'Alex', { reason: 'manual' });
      const appCallsAfterPatch = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCallsAfterPatch[1]?.url.endsWith('/rooms/ROOM-XYZ/personal-board/ai-patch')).toBe(true);
      expect(appCallsAfterPatch[1]?.body).toBe(JSON.stringify({ reason: 'manual', name: 'Alex' }));

      const profile = await api.addPersonalizationContext('Alex', 'No diagrams, use bullets');
      expect(profile.displayName).toBe('Alex');
      const appCallsAfterContext = calls.filter((call) => !call.url.endsWith('/health'));
      expect(appCallsAfterContext[2]?.url.endsWith('/personalization/context')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces HTTP status details in thrown errors', async () => {
    const api = await loadApiModule();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response('downstream exploded', { status: 500 });
    }) as unknown as typeof fetch;

    try {
      await expect(api.createRoom()).rejects.toThrow(`Create room at ${API_BASE_URL} failed: 500.`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps AbortError to timeout-style network error message', async () => {
    const api = await loadApiModule();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new DOMException('Aborted', 'AbortError');
    }) as unknown as typeof fetch;

    try {
      await expect(api.createRoom()).rejects.toThrow('timed out after 10s');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to next discovered server URL when the first request target is unreachable', async () => {
    const api = await loadApiModule({
      serverUrl: null,
      serverPort: '9100',
      serverPortSpan: '2',
      hostname: 'localhost',
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://localhost:9100/health' || url === 'http://localhost:9101/health') {
        throw new TypeError('Failed to fetch');
      }
      if (url === 'http://localhost:9100/rooms') {
        throw new TypeError('Failed to fetch');
      }
      if (url === 'http://localhost:9101/rooms') {
        return new Response(
          JSON.stringify({
            roomId: 'ROOM02',
            room: {
              id: 'ROOM02',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    try {
      const payload = await api.createRoom();
      expect(payload.roomId).toBe('ROOM02');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('adds actionable hint for network failures', async () => {
    const api = await loadApiModule();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    try {
      await expect(api.createRoom()).rejects.toThrow('bun run server');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
