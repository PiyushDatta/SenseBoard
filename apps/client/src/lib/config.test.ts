/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from 'bun:test';

type ConfigModule = typeof import('./config');

const envKeys = ['EXPO_PUBLIC_SERVER_URL', 'EXPO_PUBLIC_SERVER_PORT', 'EXPO_PUBLIC_SERVER_PORT_SPAN'] as const;

const withEnv = async <T>(
  overrides: Partial<Record<(typeof envKeys)[number], string | undefined>>,
  run: () => Promise<T>,
): Promise<T> => {
  const previous = new Map<string, string | undefined>();
  for (const key of envKeys) {
    previous.set(key, process.env[key]);
    const next = overrides[key];
    if (typeof next === 'string') {
      process.env[key] = next;
    } else {
      delete process.env[key];
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
};

const loadConfigModule = async (options?: {
  platformOs?: string;
  hostname?: string;
}): Promise<ConfigModule> => {
  const platformOs = options?.platformOs ?? 'web';
  const hostname = options?.hostname ?? 'localhost';

  mock.restore();
  mock.module('react-native', () => ({
    Platform: {
      OS: platformOs,
    },
  }));

  (globalThis as { window?: unknown }).window = {
    location: {
      hostname,
    },
  } as unknown as Window;

  return (await import(`./config.ts?test=${Date.now()}-${Math.random()}`)) as ConfigModule;
};

afterEach(() => {
  mock.restore();
  delete (globalThis as { window?: unknown }).window;
});

describe('client config', () => {
  it('uses explicit server URL when provided and trims trailing slash', async () => {
    await withEnv(
      {
        EXPO_PUBLIC_SERVER_URL: 'http://api.local:9123/',
      },
      async () => {
        const config = await loadConfigModule({ platformOs: 'web', hostname: 'ignored-host' });
        expect(config.SERVER_URL_CANDIDATES).toEqual(['http://api.local:9123']);
        expect(config.WS_URL_CANDIDATES).toEqual(['ws://api.local:9123']);
        expect(config.SERVER_URL).toBe('http://api.local:9123');
      },
    );
  });

  it('builds localhost candidate URLs from port/span on web', async () => {
    await withEnv(
      {
        EXPO_PUBLIC_SERVER_URL: undefined,
        EXPO_PUBLIC_SERVER_PORT: '9100',
        EXPO_PUBLIC_SERVER_PORT_SPAN: '3',
      },
      async () => {
        const config = await loadConfigModule({ platformOs: 'web', hostname: 'board.local' });
        expect(config.SERVER_URL_CANDIDATES).toEqual([
          'http://localhost:9100',
          'http://localhost:9101',
          'http://localhost:9102',
        ]);
        expect(config.WS_URL_CANDIDATES).toEqual([
          'ws://localhost:9100',
          'ws://localhost:9101',
          'ws://localhost:9102',
        ]);
      },
    );
  });

  it('falls back to localhost for non-web platform', async () => {
    await withEnv(
      {
        EXPO_PUBLIC_SERVER_URL: undefined,
        EXPO_PUBLIC_SERVER_PORT: '8800',
        EXPO_PUBLIC_SERVER_PORT_SPAN: '2',
      },
      async () => {
        const config = await loadConfigModule({ platformOs: 'ios', hostname: 'ignored-host' });
        expect(config.SERVER_URL_CANDIDATES).toEqual(['http://localhost:8800', 'http://localhost:8801']);
      },
    );
  });

  it('ignores invalid numeric env values and uses defaults', async () => {
    await withEnv(
      {
        EXPO_PUBLIC_SERVER_URL: undefined,
        EXPO_PUBLIC_SERVER_PORT: 'bad',
        EXPO_PUBLIC_SERVER_PORT_SPAN: '0',
      },
      async () => {
        const config = await loadConfigModule({ platformOs: 'web', hostname: 'demo-host' });
        expect(config.SERVER_URL_CANDIDATES[0]).toBe('http://localhost:8787');
        expect(config.SERVER_URL_CANDIDATES.length).toBe(8);
      },
    );
  });
});
