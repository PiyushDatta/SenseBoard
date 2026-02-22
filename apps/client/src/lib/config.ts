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

const normalizeHost = (value: string): string => {
  return value.trim().toLowerCase();
};

const dedupeHosts = (hosts: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (let index = 0; index < hosts.length; index += 1) {
    const normalized = normalizeHost(hosts[index] ?? '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
};

const getWebHostCandidates = (): string[] => {
  if (Platform.OS !== 'web') {
    return ['localhost'];
  }

  const fromWindow =
    typeof window !== 'undefined' && typeof window.location?.hostname === 'string'
      ? normalizeHost(window.location.hostname)
      : '';
  if (!fromWindow || fromWindow === '0.0.0.0') {
    return ['localhost'];
  }

  return dedupeHosts([fromWindow, 'localhost']);
};

const buildServerUrlCandidates = (): string[] => {
  if (EXPLICIT_SERVER_URL) {
    return [EXPLICIT_SERVER_URL];
  }
  const hosts = getWebHostCandidates();
  const urls: string[] = [];
  for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
    const host = hosts[hostIndex]!;
    for (let offset = 0; offset < SERVER_PORT_SPAN; offset += 1) {
      urls.push(`http://${host}:${DEFAULT_SERVER_PORT + offset}`);
    }
  }
  return urls;
};

export const SERVER_URL_CANDIDATES = buildServerUrlCandidates();
export const WS_URL_CANDIDATES = SERVER_URL_CANDIDATES.map((url) => url.replace(/^http/i, 'ws'));

export const SERVER_URL = SERVER_URL_CANDIDATES[0] ?? `http://localhost:${DEFAULT_SERVER_PORT}`;
