/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from 'bun:test';

type ApiModule = typeof import('./api');

const API_BASE_URL = 'http://api.local:9001';

const loadApiModule = async (): Promise<ApiModule> => {
  mock.restore();
  mock.module('react-native', () => ({
    Platform: {
      OS: 'web',
    },
  }));
  process.env.EXPO_PUBLIC_SERVER_URL = API_BASE_URL;
  (globalThis as { window?: unknown }).window = {
    location: { hostname: 'ignored-host' },
  } as unknown as Window;
  return (await import(`./api.ts?test=${Date.now()}-${Math.random()}`)) as ApiModule;
};

afterEach(() => {
  mock.restore();
  delete process.env.EXPO_PUBLIC_SERVER_URL;
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
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe(`${API_BASE_URL}/rooms`);
      expect(calls[0]?.method).toBe('POST');
      expect(calls[0]?.headers).toEqual({ 'Content-Type': 'application/json' });
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
      expect(calls[0]?.url.endsWith('/rooms/ROOM-XYZ')).toBe(true);

      await api.triggerAiPatch('room-xyz', { reason: 'manual', regenerate: true });
      expect(calls[1]?.url.endsWith('/rooms/ROOM-XYZ/ai-patch')).toBe(true);
      expect(calls[1]?.body).toBe(JSON.stringify({ reason: 'manual', regenerate: true }));
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
});
