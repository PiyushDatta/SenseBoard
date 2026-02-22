import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { getRuntimeConfig } from './runtime-config';

export interface PersonalizationProfile {
  nameKey: string;
  displayName: string;
  contextLines: string[];
  updatedAt: number;
}

interface StoredProfileRow {
  name_key: string;
  display_name: string;
  context_text: string;
  updated_at: number;
}

const FALLBACK_SQLITE_PATH = 'data/senseboard-personalization.sqlite';
const FALLBACK_MAX_CONTEXT_LINES = 64;

const resolvePersonalizationConfig = () => {
  const runtimeConfig = getRuntimeConfig() as {
    personalization?: {
      sqlitePath?: string;
      maxContextLines?: number;
    };
  };
  const sqlitePath = runtimeConfig.personalization?.sqlitePath?.trim() || FALLBACK_SQLITE_PATH;
  const maxContextLines =
    typeof runtimeConfig.personalization?.maxContextLines === 'number' &&
    Number.isFinite(runtimeConfig.personalization.maxContextLines) &&
    runtimeConfig.personalization.maxContextLines > 0
      ? Math.floor(runtimeConfig.personalization.maxContextLines)
      : FALLBACK_MAX_CONTEXT_LINES;
  return {
    sqlitePath: resolve(sqlitePath),
    maxContextLines,
  };
};

const config = resolvePersonalizationConfig();
mkdirSync(dirname(config.sqlitePath), { recursive: true });

const db = new Database(config.sqlitePath, { create: true });
db.exec(`
  CREATE TABLE IF NOT EXISTS personalization_profiles (
    name_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    context_text TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
`);

const normalizeNameKey = (name: string): string => name.trim().toLowerCase();
const normalizeDisplayName = (name: string): string => {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, 80);
};
const parseContextLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const toStoredRow = (name: string): StoredProfileRow | null => {
  const key = normalizeNameKey(name);
  if (!key) {
    return null;
  }
  const query = db.query<StoredProfileRow, [string]>(
    'SELECT name_key, display_name, context_text, updated_at FROM personalization_profiles WHERE name_key = ?1',
  );
  return query.get(key) ?? null;
};

const upsertProfileRow = (row: StoredProfileRow) => {
  const statement = db.query(
    `
      INSERT INTO personalization_profiles (name_key, display_name, context_text, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(name_key) DO UPDATE SET
        display_name = excluded.display_name,
        context_text = excluded.context_text,
        updated_at = excluded.updated_at
    `,
  );
  statement.run(row.name_key, row.display_name, row.context_text, row.updated_at);
};

const toProfile = (row: StoredProfileRow): PersonalizationProfile => ({
  nameKey: row.name_key,
  displayName: row.display_name,
  contextLines: parseContextLines(row.context_text),
  updatedAt: row.updated_at,
});

export const getPersonalizationStorePath = (): string => config.sqlitePath;

export const getPersonalizationProfile = (name: string): PersonalizationProfile => {
  const key = normalizeNameKey(name);
  if (!key) {
    return {
      nameKey: '',
      displayName: '',
      contextLines: [],
      updatedAt: Date.now(),
    };
  }

  const existing = toStoredRow(name);
  if (existing) {
    return toProfile(existing);
  }

  const now = Date.now();
  const displayName = normalizeDisplayName(name) || 'Guest';
  const fresh: StoredProfileRow = {
    name_key: key,
    display_name: displayName,
    context_text: '',
    updated_at: now,
  };
  upsertProfileRow(fresh);
  return toProfile(fresh);
};

export const appendPersonalizationContext = (name: string, text: string): PersonalizationProfile => {
  const key = normalizeNameKey(name);
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  if (!key || !normalizedText) {
    return getPersonalizationProfile(name);
  }

  const existing = getPersonalizationProfile(name);
  const merged = [...existing.contextLines, normalizedText].slice(-config.maxContextLines);
  const now = Date.now();
  const row: StoredProfileRow = {
    name_key: key,
    display_name: normalizeDisplayName(name) || existing.displayName || 'Guest',
    context_text: merged.join('\n'),
    updated_at: now,
  };
  upsertProfileRow(row);
  return toProfile(row);
};

export const getPersonalizationPromptLines = (name: string, maxLines = 12): string[] => {
  const profile = getPersonalizationProfile(name);
  return profile.contextLines.slice(-Math.max(1, maxLines));
};
