import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type AIProvider = 'deterministic' | 'openai' | 'codex_cli' | 'auto';

interface ServerRuntimeConfig {
  ai: {
    provider: AIProvider;
    openaiModel: string;
    codexModel: string;
    openaiApiKey: string;
    review: {
      maxRevisions: number;
      confidenceThreshold: number;
    };
  };
  server: {
    port: number;
    portScanSpan: number;
  };
  sourcePath: string | null;
}

interface ParsedTomlConfig {
  ai: {
    provider?: unknown;
    openai_model?: unknown;
    codex_model?: unknown;
    openai_api_key?: unknown;
    review?: unknown;
  };
  server: {
    port?: unknown;
    port_scan_span?: unknown;
  };
}

const DEFAULT_CONFIG: Omit<ServerRuntimeConfig, 'sourcePath'> = {
  ai: {
    provider: 'auto',
    openaiModel: 'gpt-4.1-mini',
    codexModel: 'gpt-5-codex',
    openaiApiKey: '',
    review: {
      maxRevisions: 20,
      confidenceThreshold: 0.98,
    },
  },
  server: {
    port: 8787,
    portScanSpan: 8,
  },
};

let parsedTomlCache: { config: ParsedTomlConfig; sourcePath: string | null } | null = null;

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const toPositiveIntOrUndefined = (value: unknown): number | undefined => {
  const asNumber = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(asNumber) || asNumber < 1) {
    return undefined;
  }
  return Math.floor(asNumber);
};

const toConfidenceThresholdOrUndefined = (value: unknown): number | undefined => {
  const asNumber = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(asNumber)) {
    return undefined;
  }

  // Accept either 0-1 or 0-10 format (e.g. 9.8/10).
  const normalized = asNumber > 1 ? asNumber / 10 : asNumber;
  if (normalized < 0 || normalized > 1) {
    return undefined;
  }
  return normalized;
};

const toProviderOrUndefined = (value: unknown): AIProvider | undefined => {
  const normalized = toStringOrUndefined(value)?.toLowerCase();
  if (
    normalized === 'deterministic' ||
    normalized === 'openai' ||
    normalized === 'codex_cli' ||
    normalized === 'auto'
  ) {
    return normalized;
  }
  return undefined;
};

const readTomlConfig = (): { config: ParsedTomlConfig; sourcePath: string | null } => {
  if (parsedTomlCache) {
    return parsedTomlCache;
  }

  const explicitPath = toStringOrUndefined(process.env.SENSEBOARD_CONFIG);
  const sourcePath = explicitPath ? resolve(explicitPath) : resolve(process.cwd(), 'senseboard.config.toml');

  if (!existsSync(sourcePath)) {
    parsedTomlCache = { config: { ai: {}, server: {} }, sourcePath: null };
    return parsedTomlCache;
  }

  try {
    const raw = readFileSync(sourcePath, 'utf8');
    const parsed = Bun.TOML.parse(raw);
    const root = toRecord(parsed);
    parsedTomlCache = {
      config: {
        ai: toRecord(root.ai),
        server: toRecord(root.server),
      },
      sourcePath,
    };
    return parsedTomlCache;
  } catch (error) {
    console.warn(`Failed to parse ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    parsedTomlCache = { config: { ai: {}, server: {} }, sourcePath };
    return parsedTomlCache;
  }
};

export const getRuntimeConfig = (): ServerRuntimeConfig => {
  const { config, sourcePath } = readTomlConfig();
  const reviewConfig = toRecord(config.ai.review);

  const provider =
    toProviderOrUndefined(process.env.AI_PROVIDER) ??
    toProviderOrUndefined(config.ai.provider) ??
    DEFAULT_CONFIG.ai.provider;

  const openaiModel =
    toStringOrUndefined(process.env.OPENAI_MODEL) ??
    toStringOrUndefined(config.ai.openai_model) ??
    DEFAULT_CONFIG.ai.openaiModel;

  const codexModel =
    toStringOrUndefined(process.env.CODEX_MODEL) ??
    toStringOrUndefined(config.ai.codex_model) ??
    DEFAULT_CONFIG.ai.codexModel;

  const openaiApiKey =
    toStringOrUndefined(process.env.OPENAI_API_KEY) ??
    toStringOrUndefined(config.ai.openai_api_key) ??
    DEFAULT_CONFIG.ai.openaiApiKey;

  const port =
    toPositiveIntOrUndefined(process.env.PORT) ??
    toPositiveIntOrUndefined(config.server.port) ??
    DEFAULT_CONFIG.server.port;

  const portScanSpan =
    toPositiveIntOrUndefined(process.env.PORT_SCAN_SPAN) ??
    toPositiveIntOrUndefined(config.server.port_scan_span) ??
    DEFAULT_CONFIG.server.portScanSpan;

  const maxRevisions =
    toPositiveIntOrUndefined(process.env.AI_REVIEW_MAX_REVISIONS) ??
    toPositiveIntOrUndefined(reviewConfig.max_revisions) ??
    DEFAULT_CONFIG.ai.review.maxRevisions;

  const confidenceThreshold =
    toConfidenceThresholdOrUndefined(process.env.AI_REVIEW_CONFIDENCE_THRESHOLD) ??
    toConfidenceThresholdOrUndefined(reviewConfig.confidence_threshold) ??
    DEFAULT_CONFIG.ai.review.confidenceThreshold;

  return {
    ai: {
      provider,
      openaiModel,
      codexModel,
      openaiApiKey,
      review: {
        maxRevisions,
        confidenceThreshold,
      },
    },
    server: {
      port,
      portScanSpan,
    },
    sourcePath,
  };
};
