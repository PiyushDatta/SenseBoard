import { afterEach, describe, expect, it, mock } from 'bun:test';

type TranscriptionModule = typeof import('./transcription');

const loadTranscriptionModule = async (overrides?: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  transcriptionModel?: string;
}) => {
  mock.restore();
  process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK = '0';
  mock.module('./runtime-config', () => ({
    getRuntimeConfig: () => ({
      ai: {
        provider: 'openai',
        openaiModel: 'gpt-4.1-mini',
        openaiTranscriptionModel: overrides?.transcriptionModel ?? 'whisper-1',
        anthropicModel: 'claude-3-5-sonnet-20241022',
        codexModel: 'gpt-5-codex',
        openaiApiKey: overrides?.openaiApiKey ?? 'test-key',
        anthropicApiKey: overrides?.anthropicApiKey ?? '',
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
  return (await import(`./transcription.ts?test=${Date.now()}-${Math.random()}`)) as TranscriptionModule;
};

afterEach(() => {
  mock.restore();
  delete process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK;
});

describe('transcription', () => {
  it('returns a configuration error when API key is missing', async () => {
    const module = await loadTranscriptionModule({ openaiApiKey: '' });
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const result = await module.transcribeAudioBlob(new Blob(['x'], { type: 'audio/webm' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('OPENAI_API_KEY');
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns trimmed text from OpenAI transcription response', async () => {
    const module = await loadTranscriptionModule();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          text: '  hello from whisper  ',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )) as unknown as typeof fetch;

    try {
      const result = await module.transcribeAudioBlob(new Blob(['x'], { type: 'audio/webm' }));
      expect(result).toEqual({
        ok: true,
        text: 'hello from whisper',
        provider: 'openai_whisper',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a descriptive error when OpenAI rejects the request', async () => {
    const module = await loadTranscriptionModule();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch;

    try {
      const result = await module.transcribeAudioBlob(new Blob(['x'], { type: 'audio/webm' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('OpenAI whisper failed (400)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to Claude transcription when Whisper fails', async () => {
    const module = await loadTranscriptionModule({
      openaiApiKey: 'openai-key',
      anthropicApiKey: 'anthropic-key',
    });
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/v1/audio/transcriptions')) {
        return new Response('quota exceeded', { status: 429 });
      }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'claude transcript text' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await module.transcribeAudioBlob(new Blob(['x'], { type: 'audio/webm' }));
      expect(result).toEqual({
        ok: true,
        text: 'claude transcript text',
        provider: 'anthropic',
      });
      expect(calls.some((url) => url.includes('/v1/audio/transcriptions'))).toBe(true);
      expect(calls.some((url) => url.includes('/v1/messages'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
