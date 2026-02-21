import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '../../shared/room-state';
import { getRuntimeConfig } from './runtime-config';

export interface TranscriptionResult {
  ok: boolean;
  text: string;
  provider?: 'openai_whisper' | 'anthropic' | 'codex_cli';
  error?: string;
}

type TranscriptionProviderId = NonNullable<TranscriptionResult['provider']>;

export interface TranscriptionPreflightResult {
  ok: boolean;
  provider: string;
  resolvedProvider?: TranscriptionProviderId;
  response?: string;
  error?: string;
}

const OPENAI_TRANSCRIPT_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const CODEX_REASONING_EFFORT = 'high';

const logTranscription = (message: string) => {
  console.log(`[Transcription] ${message}`);
};

const isCodexTranscribeFallbackEnabled = (): boolean => {
  return process.env.SENSEBOARD_ENABLE_CODEX_TRANSCRIBE_FALLBACK !== '0';
};

const extensionFromMime = (mimeType: string): string => {
  const lower = mimeType.toLowerCase();
  if (lower.includes('ogg')) {
    return 'ogg';
  }
  if (lower.includes('mp4') || lower.includes('m4a')) {
    return 'm4a';
  }
  if (lower.includes('wav')) {
    return 'wav';
  }
  if (lower.includes('mpeg') || lower.includes('mp3')) {
    return 'mp3';
  }
  return 'webm';
};

const normalizeMimeType = (mimeType: string): string => {
  const lower = mimeType.toLowerCase().split(';')[0]?.trim() || 'audio/webm';
  if (lower === 'audio/webm' || lower === 'audio/ogg' || lower === 'audio/wav' || lower === 'audio/mpeg' || lower === 'audio/mp4') {
    return lower;
  }
  return 'audio/webm';
};

const safeErrorText = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  return body.replace(/\s+/g, ' ').trim().slice(0, 220);
};

const extractAnthropicText = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const root = value as { content?: unknown };
  if (!Array.isArray(root.content)) {
    return '';
  }
  const textBlocks = root.content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const block = item as { type?: unknown; text?: unknown };
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter((text) => text.length > 0);
  return textBlocks.join('\n').trim();
};

const blobToBase64 = async (audio: Blob): Promise<string> => {
  const buffer = await audio.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
};

const isCodexLoggedIn = (exitCode: number, output: string): boolean => {
  if (exitCode !== 0) {
    return false;
  }
  const normalized = output.toLowerCase();
  if (
    normalized.includes('not logged in') ||
    normalized.includes("you're not logged in") ||
    normalized.includes('you are not logged in') ||
    normalized.includes('logged out') ||
    normalized.includes('login required') ||
    normalized.includes('not authenticated')
  ) {
    return false;
  }
  return normalized.includes('logged in') || normalized.includes('authenticated');
};

const checkCodexReady = (): boolean => {
  try {
    const status = Bun.spawnSync({
      cmd: ['codex', 'login', 'status'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 1200,
    });
    const stdout = status.stdout ? new TextDecoder().decode(status.stdout) : '';
    const stderr = status.stderr ? new TextDecoder().decode(status.stderr) : '';
    return isCodexLoggedIn(status.exitCode, `${stdout}\n${stderr}`);
  } catch {
    return false;
  }
};

const transcribeWithOpenAiWhisper = async (
  audio: Blob,
  mimeType: string,
): Promise<TranscriptionResult> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.openaiApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      text: '',
      error: 'OPENAI_API_KEY is missing.',
    };
  }

  const ext = extensionFromMime(mimeType);
  const model = runtimeConfig.ai.openaiTranscriptionModel;
  const payload = new FormData();
  payload.append('model', model);
  payload.append('language', 'en');
  payload.append('file', new File([audio], `senseboard-chunk.${ext}`, { type: mimeType }));

  const response = await fetch(OPENAI_TRANSCRIPT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const detail = await safeErrorText(response);
    return {
      ok: false,
      text: '',
      error: `OpenAI whisper failed (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const data = (await response.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) {
    return {
      ok: false,
      text: '',
      error: 'OpenAI whisper returned an empty transcript.',
    };
  }

  return {
    ok: true,
    text,
    provider: 'openai_whisper',
  };
};

const transcribeWithAnthropic = async (
  audio: Blob,
  mimeType: string,
): Promise<TranscriptionResult> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.anthropicApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      text: '',
      error: 'ANTHROPIC_API_KEY is missing.',
    };
  }

  const base64Audio = await blobToBase64(audio);
  const normalizedMime = normalizeMimeType(mimeType);
  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.anthropicModel,
      max_tokens: 1400,
      temperature: 0,
      system:
        'You are a speech-to-text engine. Transcribe spoken content from the audio input. Return plain text only, no markdown.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this meeting audio. Return only the transcript text.',
            },
            {
              type: 'audio',
              source: {
                type: 'base64',
                media_type: normalizedMime,
                data: base64Audio,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await safeErrorText(response);
    return {
      ok: false,
      text: '',
      error: `Claude transcription failed (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const data = (await response.json().catch(() => null)) as unknown;
  const text = extractAnthropicText(data);
  if (!text) {
    return {
      ok: false,
      text: '',
      error: 'Claude transcription returned an empty transcript.',
    };
  }

  return {
    ok: true,
    text,
    provider: 'anthropic',
  };
};

const transcribeWithCodex = async (
  audio: Blob,
  mimeType: string,
): Promise<TranscriptionResult> => {
  if (!checkCodexReady()) {
    return {
      ok: false,
      text: '',
      error: 'Codex CLI is not available/authenticated.',
    };
  }

  const base64Audio = await blobToBase64(audio);
  const inputFile = join(tmpdir(), `senseboard-codex-audio-${newId()}.txt`);
  const outputFile = join(tmpdir(), `senseboard-codex-transcript-${newId()}.txt`);

  try {
    writeFileSync(inputFile, base64Audio, 'utf8');
    const model = getRuntimeConfig().ai.codexModel;
    const prompt = [
      'You are a fallback speech-to-text engine.',
      `The audio is base64 encoded in this file: ${inputFile}`,
      `Audio MIME type: ${mimeType}`,
      'Transcribe the spoken words and return plain text only.',
      'If transcription is impossible, return an empty response.',
    ].join('\n');

    const result = Bun.spawnSync({
      cmd: [
        'codex',
        'exec',
        '--output-last-message',
        outputFile,
        '--color',
        'never',
        '-m',
        model,
        '-c',
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        prompt,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 45000,
    });

    if (result.exitCode !== 0 || !existsSync(outputFile)) {
      const stdout = result.stdout ? new TextDecoder().decode(result.stdout) : '';
      const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : '';
      return {
        ok: false,
        text: '',
        error: `Codex transcription failed: ${(stdout + stderr).replace(/\s+/g, ' ').trim().slice(0, 200)}`,
      };
    }

    const text = readFileSync(outputFile, 'utf8').trim();
    if (!text) {
      return {
        ok: false,
        text: '',
        error: 'Codex transcription returned an empty transcript.',
      };
    }

    return {
      ok: true,
      text,
      provider: 'codex_cli',
    };
  } catch (error) {
    return {
      ok: false,
      text: '',
      error: `Codex transcription exception: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (existsSync(inputFile)) {
      unlinkSync(inputFile);
    }
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  }
};

const probeOpenAiWhisperModelAccess = async (): Promise<{
  ok: boolean;
  provider: 'openai_whisper';
  response?: string;
  error?: string;
}> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.openaiApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      provider: 'openai_whisper',
      error: 'OPENAI_API_KEY is missing.',
    };
  }

  const model = runtimeConfig.ai.openaiTranscriptionModel.trim() || 'whisper-1';
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const detail = await safeErrorText(response);
    return {
      ok: false,
      provider: 'openai_whisper',
      error: `OpenAI whisper preflight failed (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
  const modelId = typeof payload?.id === 'string' && payload.id.trim().length > 0 ? payload.id.trim() : model;
  return {
    ok: true,
    provider: 'openai_whisper',
    response: `model access ok (${modelId})`,
  };
};

const probeAnthropicTranscriptionFallback = async (): Promise<{
  ok: boolean;
  provider: 'anthropic';
  response?: string;
  error?: string;
}> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.anthropicApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      provider: 'anthropic',
      error: 'ANTHROPIC_API_KEY is missing.',
    };
  }

  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.anthropicModel,
      max_tokens: 64,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: transcription preflight ok',
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await safeErrorText(response);
    return {
      ok: false,
      provider: 'anthropic',
      error: `Claude fallback preflight failed (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const text = extractAnthropicText(payload);
  if (!text) {
    return {
      ok: false,
      provider: 'anthropic',
      error: 'Claude fallback preflight returned an empty response.',
    };
  }

  return {
    ok: true,
    provider: 'anthropic',
    response: text,
  };
};

const probeCodexTranscriptionFallback = async (): Promise<{
  ok: boolean;
  provider: 'codex_cli';
  response?: string;
  error?: string;
}> => {
  if (!checkCodexReady()) {
    return {
      ok: false,
      provider: 'codex_cli',
      error: 'Codex CLI is not available/authenticated.',
    };
  }

  const outputFile = join(tmpdir(), `senseboard-codex-transcribe-preflight-${newId()}.txt`);
  const model = getRuntimeConfig().ai.codexModel;

  try {
    const result = Bun.spawnSync({
      cmd: [
        'codex',
        'exec',
        '--output-last-message',
        outputFile,
        '--color',
        'never',
        '-m',
        model,
        '-c',
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        'Reply with exactly: transcription preflight ok',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
    });

    if (result.exitCode !== 0 || !existsSync(outputFile)) {
      const stdout = result.stdout ? new TextDecoder().decode(result.stdout) : '';
      const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : '';
      return {
        ok: false,
        provider: 'codex_cli',
        error: `Codex fallback preflight failed: ${(stdout + stderr).replace(/\s+/g, ' ').trim().slice(0, 200)}`,
      };
    }

    const text = readFileSync(outputFile, 'utf8').trim();
    if (!text) {
      return {
        ok: false,
        provider: 'codex_cli',
        error: 'Codex fallback preflight returned an empty response.',
      };
    }

    return {
      ok: true,
      provider: 'codex_cli',
      response: text,
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'codex_cli',
      error: `Codex fallback preflight exception: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  }
};

export const runTranscriptionPreflightCheck = async (): Promise<TranscriptionPreflightResult> => {
  const providerLabel = getTranscriptionProviderLabel();
  const errors: string[] = [];

  logTranscription('Preflight route primary=openai_whisper');
  const whisper = await probeOpenAiWhisperModelAccess().catch(() => ({
    ok: false,
    provider: 'openai_whisper' as const,
    response: '',
    error: 'OpenAI whisper preflight threw an exception.',
  }));
  if (whisper.ok) {
    return {
      ok: true,
      provider: providerLabel,
      resolvedProvider: whisper.provider,
      response: whisper.response,
    };
  }
  if (whisper.error) {
    errors.push(whisper.error);
    logTranscription(`OpenAI whisper preflight failed: ${whisper.error}`);
  }

  logTranscription('Preflight fallback -> anthropic');
  const anthropic = await probeAnthropicTranscriptionFallback().catch(() => ({
    ok: false,
    provider: 'anthropic' as const,
    response: '',
    error: 'Claude fallback preflight threw an exception.',
  }));
  if (anthropic.ok) {
    logTranscription('Claude transcription fallback preflight succeeded.');
    return {
      ok: true,
      provider: providerLabel,
      resolvedProvider: anthropic.provider,
      response: anthropic.response,
    };
  }
  if (anthropic.error) {
    errors.push(anthropic.error);
    logTranscription(`Claude transcription fallback preflight failed: ${anthropic.error}`);
  }

  logTranscription('Preflight fallback -> codex_cli');
  if (!isCodexTranscribeFallbackEnabled()) {
    logTranscription('Codex transcription fallback preflight disabled by env.');
    return {
      ok: false,
      provider: providerLabel,
      error: errors.length > 0 ? errors.join(' | ') : 'Codex transcription fallback preflight is disabled.',
    };
  }

  const codex = await probeCodexTranscriptionFallback().catch(() => ({
    ok: false,
    provider: 'codex_cli' as const,
    response: '',
    error: 'Codex fallback preflight threw an exception.',
  }));
  if (codex.ok) {
    logTranscription('Codex transcription fallback preflight succeeded.');
    return {
      ok: true,
      provider: providerLabel,
      resolvedProvider: codex.provider,
      response: codex.response,
    };
  }
  if (codex.error) {
    errors.push(codex.error);
    logTranscription(`Codex transcription fallback preflight failed: ${codex.error}`);
  }

  return {
    ok: false,
    provider: providerLabel,
    error: errors.length > 0 ? errors.join(' | ') : 'No transcription provider preflight succeeded.',
  };
};

export const transcribeAudioBlob = async (audio: Blob): Promise<TranscriptionResult> => {
  if (audio.size === 0) {
    return {
      ok: false,
      text: '',
      error: 'Audio chunk is empty.',
    };
  }

  const mimeType = normalizeMimeType(audio.type?.trim() || 'audio/webm');
  const errors: string[] = [];

  logTranscription('Route primary=openai_whisper');
  const whisper = await transcribeWithOpenAiWhisper(audio, mimeType);
  if (whisper.ok) {
    logTranscription('OpenAI whisper transcription succeeded.');
    return whisper;
  }
  if (whisper.error) {
    errors.push(whisper.error);
    logTranscription(`OpenAI whisper failed: ${whisper.error}`);
  }

  logTranscription('Fallback -> anthropic');
  const anthropic = await transcribeWithAnthropic(audio, mimeType);
  if (anthropic.ok) {
    logTranscription('Claude transcription fallback succeeded.');
    return anthropic;
  }
  if (anthropic.error) {
    errors.push(anthropic.error);
    logTranscription(`Claude transcription fallback failed: ${anthropic.error}`);
  }

  logTranscription('Fallback -> codex_cli');
  if (!isCodexTranscribeFallbackEnabled()) {
    logTranscription('Codex transcription fallback disabled by env.');
    return {
      ok: false,
      text: '',
      error: errors.length > 0 ? errors.join(' | ') : 'Codex transcription fallback is disabled.',
    };
  }
  const codex = await transcribeWithCodex(audio, mimeType);
  if (codex.ok) {
    logTranscription('Codex transcription fallback succeeded.');
    return codex;
  }
  if (codex.error) {
    errors.push(codex.error);
    logTranscription(`Codex transcription fallback failed: ${codex.error}`);
  }

  return {
    ok: false,
    text: '',
    error: errors.length > 0 ? errors.join(' | ') : 'No transcription provider succeeded.',
  };
};

export const getTranscriptionProviderLabel = (): string => {
  const runtimeConfig = getRuntimeConfig();
  const chain = [
    `openai_whisper:${runtimeConfig.ai.openaiTranscriptionModel}`,
    `anthropic:${runtimeConfig.ai.anthropicModel}`,
    isCodexTranscribeFallbackEnabled() ? `codex_cli:${runtimeConfig.ai.codexModel}` : 'codex_cli:disabled',
  ];
  return chain.join('->');
};
