import { getRuntimeConfig } from './runtime-config';

export interface TranscriptionResult {
  ok: boolean;
  text: string;
  error?: string;
}

const OPENAI_TRANSCRIPT_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

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

const safeErrorText = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  return body.replace(/\s+/g, ' ').trim().slice(0, 220);
};

export const transcribeAudioBlob = async (audio: Blob): Promise<TranscriptionResult> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.openaiApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      text: '',
      error: 'OPENAI_API_KEY is missing.',
    };
  }

  if (audio.size === 0) {
    return {
      ok: false,
      text: '',
      error: 'Audio chunk is empty.',
    };
  }

  const mimeType = audio.type?.trim() || 'audio/webm';
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
      error: `OpenAI transcription failed (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const data = (await response.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  return {
    ok: true,
    text,
  };
};
