import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { generateBoardOps, runAiPreflightCheck } from '../../apps/server/src/ai-engine';
import { getRuntimeConfig } from '../../apps/server/src/runtime-config';
import { transcribeAudioBlob } from '../../apps/server/src/transcription';
import { createEmptyRoom, newId } from '../../apps/shared/room-state';
import type { TriggerPatchRequest } from '../../apps/shared/types';

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const RECORDING_FIXTURE_ROOT = join(process.cwd(), 'test_recording_data');
const VALID_RECORDING_FIXTURE_DIR = join(RECORDING_FIXTURE_ROOT, 'valid');
const LEGACY_INVALID_RECORDING_FIXTURE_DIR = join(RECORDING_FIXTURE_ROOT, 'legacy_invalid');

const toAudioMimeType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.wav') {
    return 'audio/wav';
  }
  if (extension === '.ogg' || extension === '.oga') {
    return 'audio/ogg';
  }
  if (extension === '.mp3' || extension === '.mpga' || extension === '.mpeg') {
    return 'audio/mpeg';
  }
  if (extension === '.m4a' || extension === '.mp4') {
    return 'audio/mp4';
  }
  return 'audio/webm';
};

const getFixtureAudioPaths = (directoryPath: string): string[] => {
  if (!existsSync(directoryPath)) {
    return [];
  }
  return readdirSync(directoryPath)
    .filter((name) => /\.(webm|wav|ogg|oga|mp3|mpga|mpeg|m4a|mp4)$/i.test(name))
    .sort()
    .map((name) => join(directoryPath, name));
};

const readFixtureAudioBlob = (filePath: string): Blob => {
  const bytes = readFileSync(filePath);
  return new Blob([bytes], { type: toAudioMimeType(filePath) });
};

const buildTriggerRequest = (): TriggerPatchRequest => ({
  reason: 'manual',
  regenerate: false,
  windowSeconds: 40,
});

const synthesizeSpeechSample = async (apiKey: string, text: string): Promise<Blob> => {
  const response = await fetch(OPENAI_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'alloy',
      response_format: 'wav',
      input: text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed (${response.status}): ${detail.slice(0, 260)}`);
  }

  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: 'audio/wav' });
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const generateBoardOpsWithRetries = async (attempts = 3) => {
  const room = createEmptyRoom(`INTEG-${newId().slice(0, 8).toUpperCase()}`);
  const now = Date.now();
  room.transcriptChunks.push({
    id: newId(),
    speaker: 'Host',
    text: 'We have a tree with root A, children B and C, and B has D and E.',
    source: 'mic',
    createdAt: now - 1_000,
  });
  room.chatMessages.push({
    id: newId(),
    authorId: 'host',
    authorName: 'Host',
    text: 'Correction: traversal should be post-order.',
    kind: 'correction',
    createdAt: now - 500,
  });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await generateBoardOps(room, buildTriggerRequest());
    if (result && result.ops.length > 0) {
      return result;
    }
    if (attempt < attempts) {
      await wait(900);
    }
  }
  return null;
};

describe('paid integration: ai providers', () => {
  it('transcribes generated speech with whisper pipeline', async () => {
    const config = getRuntimeConfig();
    const openAiApiKey = config.ai.openaiApiKey.trim();
    expect(openAiApiKey.length).toBeGreaterThan(0);

    const sampleAudio = await synthesizeSpeechSample(
      openAiApiKey,
      'SenseBoard integration test. We are validating speech transcription pipeline.',
    );
    expect(sampleAudio.size).toBeGreaterThan(1_000);

    const result = await transcribeAudioBlob(sampleAudio);
    if (!result.ok) {
      throw new Error(`Transcription integration failed: ${result.error ?? 'unknown error'}`);
    }

    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.provider).toBeDefined();
  });

  it('transcribes saved valid recording fixtures from test_recording_data', async () => {
    const fixtures = getFixtureAudioPaths(VALID_RECORDING_FIXTURE_DIR);
    expect(fixtures.length).toBeGreaterThan(0);

    for (const fixturePath of fixtures) {
      const result = await transcribeAudioBlob(readFixtureAudioBlob(fixturePath));
      if (!result.ok) {
        throw new Error(`Fixture transcription failed for ${fixturePath}: ${result.error ?? 'unknown error'}`);
      }
      expect(result.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('reproduces legacy invalid-chunk failure from fixture recordings', async () => {
    const fixtures = getFixtureAudioPaths(LEGACY_INVALID_RECORDING_FIXTURE_DIR);
    expect(fixtures.length).toBeGreaterThan(0);

    const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const previousCodexFallback = process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK;
    process.env.ANTHROPIC_API_KEY = '';
    process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK = '0';

    try {
      const result = await transcribeAudioBlob(readFixtureAudioBlob(fixtures[0]));
      expect(result.ok).toBe(false);
      expect((result.error ?? '').toLowerCase()).toContain('invalid file format');
    } finally {
      if (typeof previousAnthropicApiKey === 'string') {
        process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
      if (typeof previousCodexFallback === 'string') {
        process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK = previousCodexFallback;
      } else {
        delete process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK;
      }
    }
  });

  it('generates board ops from transcript text using configured AI route', async () => {
    const preflight = await runAiPreflightCheck();
    if (!preflight.ok) {
      throw new Error(`Main AI preflight failed before board-op test: ${preflight.error ?? preflight.provider}`);
    }

    const generated = await generateBoardOpsWithRetries(3);
    expect(generated).not.toBeNull();
    expect((generated?.ops.length ?? 0) > 0).toBe(true);
  });
});
