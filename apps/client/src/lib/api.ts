import type { BoardState, RoomState, TriggerPatchRequest } from '../../../shared/types';
import { SERVER_URL, SERVER_URL_CANDIDATES } from './config';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const REQUEST_TIMEOUT_MS = 10000;
const HEALTHCHECK_TIMEOUT_MS = 900;
interface HealthProbeResult {
  url: string;
  startedAt: number;
}

class HttpStatusError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let resolvedServerUrl: string | null = process.env.EXPO_PUBLIC_SERVER_URL ? SERVER_URL_CANDIDATES[0] ?? SERVER_URL : null;
let resolvingServerUrl: Promise<string> | null = null;

const buildNetworkError = (context: string, error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`${context} timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
  }
  if (error instanceof Error && error.message) {
    return new Error(`${context} failed: ${error.message}`);
  }
  return new Error(`${context} failed.`);
};

const executeRequest = async <T>(baseUrl: string, path: string, options: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = text ? ` ${text}` : '';
      throw new HttpStatusError(response.status, `${response.status}.${detail}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

const probeServerHealth = async (baseUrl: string): Promise<HealthProbeResult | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      instanceStartedAt?: unknown;
    };
    const startedAt =
      typeof payload.instanceStartedAt === 'number' && Number.isFinite(payload.instanceStartedAt)
        ? payload.instanceStartedAt
        : 0;
    return {
      url: baseUrl,
      startedAt,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const findReachableServerUrl = async (): Promise<string> => {
  const probes = await Promise.all(SERVER_URL_CANDIDATES.map((candidate) => probeServerHealth(candidate)));
  const reachable = probes.filter((probe): probe is HealthProbeResult => probe !== null);
  if (reachable.length > 0) {
    let best = reachable[0]!;
    for (let index = 1; index < reachable.length; index += 1) {
      const candidate = reachable[index]!;
      if (candidate.startedAt > best.startedAt) {
        best = candidate;
      }
    }
    return best.url;
  }
  return SERVER_URL;
};

const resolveServerUrl = async (): Promise<string> => {
  if (resolvedServerUrl) {
    return resolvedServerUrl;
  }

  if (!resolvingServerUrl) {
    resolvingServerUrl = findReachableServerUrl()
      .then((url) => {
        resolvedServerUrl = url;
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info(`[SenseBoard API] using server ${url}`);
        }
        return url;
      })
      .finally(() => {
        resolvingServerUrl = null;
      });
  }

  return resolvingServerUrl;
};

const requestJson = async <T>(path: string, options: RequestInit, context: string): Promise<T> => {
  const firstUrl = await resolveServerUrl();
  try {
    return await executeRequest<T>(firstUrl, path, options);
  } catch (error) {
    if (error instanceof HttpStatusError) {
      throw buildNetworkError(`${context} at ${firstUrl}`, error);
    }

    resolvedServerUrl = null;
    const retryUrl = await resolveServerUrl();
    if (retryUrl !== firstUrl) {
      try {
        return await executeRequest<T>(retryUrl, path, options);
      } catch (retryError) {
        throw buildNetworkError(`${context} at ${retryUrl}`, retryError);
      }
    }
    throw buildNetworkError(`${context} at ${firstUrl}`, error);
  }
};

export const createRoom = async (): Promise<{ roomId: string; room: RoomState }> => {
  return requestJson<{ roomId: string; room: RoomState }>(
    '/rooms',
    {
      method: 'POST',
      headers: jsonHeaders,
    },
    'Create room',
  );
};

export const getRoom = async (roomId: string): Promise<RoomState> => {
  const payload = await requestJson<{ room: RoomState }>(
    `/rooms/${encodeURIComponent(roomId.toUpperCase())}`,
    {
      method: 'GET',
    },
    `Join room ${roomId.toUpperCase()}`,
  );
  return payload.room;
};

export const triggerAiPatch = async (roomId: string, request: TriggerPatchRequest) => {
  return requestJson<{
    applied: boolean;
    reason?: string;
  }>(
    `/rooms/${encodeURIComponent(roomId.toUpperCase())}/ai-patch`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(request),
    },
    `Trigger AI patch for room ${roomId.toUpperCase()}`,
  );
};

export interface TranscribeAudioResponse {
  ok: boolean;
  text: string;
  accepted?: boolean;
  reason?: string;
  error?: string;
}

const extensionForMimeType = (mimeType: string): string => {
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

export const transcribeAudioChunk = async (
  roomId: string,
  speaker: string,
  audioChunk: Blob,
  mimeType?: string,
): Promise<TranscribeAudioResponse> => {
  const normalizedMime = (mimeType || audioChunk.type || 'audio/webm').trim() || 'audio/webm';
  const ext = extensionForMimeType(normalizedMime);
  const form = new FormData();
  form.append('speaker', speaker.trim() || 'Speaker');
  form.append('audio', new File([audioChunk], `chunk.${ext}`, { type: normalizedMime }));

  return requestJson<TranscribeAudioResponse>(
    `/rooms/${encodeURIComponent(roomId.toUpperCase())}/transcribe`,
    {
      method: 'POST',
      body: form,
    },
    `Transcribe audio for room ${roomId.toUpperCase()}`,
  );
};

export interface PersonalBoardResponse {
  board: BoardState;
  updatedAt: number;
}

export const getPersonalBoard = async (roomId: string, memberName: string): Promise<PersonalBoardResponse> => {
  return requestJson<PersonalBoardResponse>(
    `/rooms/${encodeURIComponent(roomId.toUpperCase())}/personal-board?name=${encodeURIComponent(memberName.trim())}`,
    {
      method: 'GET',
    },
    `Get personal board for ${memberName.trim() || 'member'} in room ${roomId.toUpperCase()}`,
  );
};

export const triggerPersonalBoardPatch = async (
  roomId: string,
  memberName: string,
  request: TriggerPatchRequest,
) => {
  return requestJson<{
    applied: boolean;
    reason?: string;
  }>(
    `/rooms/${encodeURIComponent(roomId.toUpperCase())}/personal-board/ai-patch`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...request,
        name: memberName.trim(),
      }),
    },
    `Trigger personal AI patch for ${memberName.trim() || 'member'} in room ${roomId.toUpperCase()}`,
  );
};

export interface PersonalizationProfile {
  nameKey: string;
  displayName: string;
  contextLines: string[];
  updatedAt: number;
}

export const addPersonalizationContext = async (memberName: string, text: string): Promise<PersonalizationProfile> => {
  const payload = await requestJson<{
    ok: boolean;
    profile: PersonalizationProfile;
  }>(
    '/personalization/context',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: memberName.trim(),
        text: text.trim(),
      }),
    },
    `Add personalization context for ${memberName.trim() || 'member'}`,
  );
  return payload.profile;
};
