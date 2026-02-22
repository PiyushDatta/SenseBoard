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
const PERSONALIZATION_FLUSH_INTERVAL_MS = 1500;
const PERSONALIZATION_FLUSH_BATCH_SIZE = 120;
const PERSONALIZATION_YIELD_EVERY = 24;

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

const selectAllProfiles = db.query<StoredProfileRow, []>(
  'SELECT name_key, display_name, context_text, updated_at FROM personalization_profiles',
);

const upsertProfileStatement = db.query(
  `
    INSERT INTO personalization_profiles (name_key, display_name, context_text, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(name_key) DO UPDATE SET
      display_name = excluded.display_name,
      context_text = excluded.context_text,
      updated_at = excluded.updated_at
  `,
);

const toProfile = (row: StoredProfileRow): PersonalizationProfile => ({
  nameKey: row.name_key,
  displayName: row.display_name,
  contextLines: parseContextLines(row.context_text),
  updatedAt: row.updated_at,
});

const profileCache = new Map<string, PersonalizationProfile>();
const dirtyKeys = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInProgress = false;
let hydrationStarted = false;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const cloneProfile = (profile: PersonalizationProfile): PersonalizationProfile => ({
  nameKey: profile.nameKey,
  displayName: profile.displayName,
  contextLines: [...profile.contextLines],
  updatedAt: profile.updatedAt,
});

const upsertStoredRowSync = (row: StoredProfileRow) => {
  upsertProfileStatement.run(row.name_key, row.display_name, row.context_text, row.updated_at);
};

const markDirty = (nameKey: string) => {
  if (!nameKey) {
    return;
  }
  dirtyKeys.add(nameKey);
  if (!flushTimer && !flushInProgress) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushDirtyProfilesInBackground();
    }, PERSONALIZATION_FLUSH_INTERVAL_MS);
  }
};

const flushDirtyProfilesSync = (limit = Number.POSITIVE_INFINITY) => {
  if (dirtyKeys.size === 0) {
    return;
  }
  let processed = 0;
  while (dirtyKeys.size > 0 && processed < limit) {
    const iterator = dirtyKeys.values().next();
    const key = iterator.value as string | undefined;
    if (!key) {
      break;
    }
    dirtyKeys.delete(key);
    const profile = profileCache.get(key);
    if (!profile) {
      continue;
    }
    upsertStoredRowSync({
      name_key: profile.nameKey,
      display_name: profile.displayName,
      context_text: profile.contextLines.join('\n'),
      updated_at: profile.updatedAt,
    });
    processed += 1;
  }
};

const flushDirtyProfilesInBackground = async () => {
  if (flushInProgress || dirtyKeys.size === 0) {
    return;
  }
  flushInProgress = true;
  try {
    flushDirtyProfilesSync(PERSONALIZATION_FLUSH_BATCH_SIZE);
    if (dirtyKeys.size > 0) {
      await wait(0);
    }
  } catch {
    // Best-effort persistence only for demo speed.
  } finally {
    flushInProgress = false;
    if (dirtyKeys.size > 0 && !flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushDirtyProfilesInBackground();
      }, PERSONALIZATION_FLUSH_INTERVAL_MS);
    }
  }
};

const startBackgroundHydration = () => {
  if (hydrationStarted) {
    return;
  }
  hydrationStarted = true;
  setTimeout(() => {
    void (async () => {
      try {
        const rows = selectAllProfiles.all();
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const cached = profileCache.get(row.name_key);
          if (!cached || cached.updatedAt < row.updated_at) {
            profileCache.set(row.name_key, toProfile(row));
          }
          if ((index + 1) % PERSONALIZATION_YIELD_EVERY === 0) {
            await wait(0);
          }
        }
      } catch {
        // Ignore hydration failures and keep running from memory.
      }
    })();
  }, 0);
};

const flushOnExit = () => {
  try {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushDirtyProfilesSync();
  } catch {
    // no-op
  }
};

startBackgroundHydration();
process.on('beforeExit', flushOnExit);
process.on('exit', flushOnExit);

export const getPersonalizationStorePath = (): string => config.sqlitePath;

const getOrCreateCachedProfile = (name: string): PersonalizationProfile => {
  const key = normalizeNameKey(name);
  if (!key) {
    return {
      nameKey: '',
      displayName: '',
      contextLines: [],
      updatedAt: Date.now(),
    };
  }
  const existing = profileCache.get(key);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const displayName = normalizeDisplayName(name) || 'Guest';
  const fresh: PersonalizationProfile = {
    nameKey: key,
    displayName,
    contextLines: [],
    updatedAt: now,
  };
  profileCache.set(key, fresh);
  markDirty(key);
  return fresh;
};

export const getPersonalizationProfile = (name: string): PersonalizationProfile => {
  return cloneProfile(getOrCreateCachedProfile(name));
};

export const appendPersonalizationContext = (name: string, text: string): PersonalizationProfile => {
  const key = normalizeNameKey(name);
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  if (!key || !normalizedText) {
    return getPersonalizationProfile(name);
  }

  const existing = getOrCreateCachedProfile(name);
  const merged = [...existing.contextLines, normalizedText].slice(-config.maxContextLines);
  const now = Date.now();
  const nextProfile: PersonalizationProfile = {
    nameKey: key,
    displayName: normalizeDisplayName(name) || existing.displayName || 'Guest',
    contextLines: merged,
    updatedAt: now,
  };
  profileCache.set(key, nextProfile);
  markDirty(key);
  return cloneProfile(nextProfile);
};

export const getPersonalizationPromptLines = (name: string, maxLines = 12): string[] => {
  const profile = getOrCreateCachedProfile(name);
  return profile.contextLines.slice(-Math.max(1, maxLines));
};
