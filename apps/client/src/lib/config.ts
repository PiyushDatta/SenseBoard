import { Platform } from 'react-native';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

const EXPLICIT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL?.replace(/\/+$/, '');
const DEFAULT_SERVER_PORT = parsePositiveInt(process.env.EXPO_PUBLIC_SERVER_PORT, 8787);
const SERVER_PORT_SPAN = parsePositiveInt(process.env.EXPO_PUBLIC_SERVER_PORT_SPAN, 8);

const buildServerUrlCandidates = (): string[] => {
  if (EXPLICIT_SERVER_URL) {
    return [EXPLICIT_SERVER_URL];
  }
  const host = 'localhost';
  const urls: string[] = [];
  for (let offset = 0; offset < SERVER_PORT_SPAN; offset += 1) {
    urls.push(`http://${host}:${DEFAULT_SERVER_PORT + offset}`);
  }
  return urls;
};

export const SERVER_URL_CANDIDATES = buildServerUrlCandidates();
export const WS_URL_CANDIDATES = SERVER_URL_CANDIDATES.map((url) => url.replace(/^http/i, 'ws'));

export const SERVER_URL = SERVER_URL_CANDIDATES[0] ?? `http://localhost:${DEFAULT_SERVER_PORT}`;
