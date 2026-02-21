import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type RuntimeConfigModule = typeof import('./runtime-config');

const tempRoot = join(process.cwd(), '.tmp-runtime-config-tests');
const touchedFiles = new Set<string>();

const envKeys = [
  'SENSEBOARD_CONFIG',
  'AI_PROVIDER',
  'OPENAI_MODEL',
  'CODEX_MODEL',
  'OPENAI_API_KEY',
  'PORT',
  'PORT_SCAN_SPAN',
  'AI_REVIEW_MAX_REVISIONS',
  'AI_REVIEW_CONFIDENCE_THRESHOLD',
] as const;

const withEnv = async <T>(overrides: Partial<Record<(typeof envKeys)[number], string | undefined>>, run: () => Promise<T>) => {
  const previous = new Map<string, string | undefined>();
  for (const key of envKeys) {
    previous.set(key, process.env[key]);
    const next = overrides[key];
    if (typeof next === 'string') {
      process.env[key] = next;
    } else {
      delete process.env[key];
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
};

const ensureTempRoot = () => {
  if (!existsSync(tempRoot)) {
    mkdirSync(tempRoot, { recursive: true });
  }
};

const writeTempToml = (name: string, body: string) => {
  ensureTempRoot();
  const filePath = join(tempRoot, name);
  writeFileSync(filePath, body, 'utf8');
  touchedFiles.add(filePath);
  return filePath;
};

const loadRuntimeConfigModule = async (): Promise<RuntimeConfigModule> => {
  return (await import(`./runtime-config.ts?test=${Date.now()}-${Math.random()}`)) as RuntimeConfigModule;
};

afterEach(() => {
  for (const filePath of touchedFiles) {
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
  touchedFiles.clear();
});

describe('runtime-config', () => {
  it('uses defaults when config file does not exist', async () => {
    await withEnv(
      {
        SENSEBOARD_CONFIG: join(tempRoot, 'missing.toml'),
      },
      async () => {
        const runtimeConfig = (await loadRuntimeConfigModule()).getRuntimeConfig();
        expect(runtimeConfig.ai.provider).toBe('auto');
        expect(runtimeConfig.ai.openaiModel).toBe('gpt-4.1-mini');
        expect(runtimeConfig.ai.codexModel).toBe('gpt-5-codex');
        expect(runtimeConfig.server.port).toBe(8787);
        expect(runtimeConfig.server.portScanSpan).toBe(8);
        expect(runtimeConfig.ai.review.maxRevisions).toBe(20);
        expect(runtimeConfig.ai.review.confidenceThreshold).toBe(0.98);
        expect(runtimeConfig.sourcePath).toBeNull();
      },
    );
  });

  it('reads values from TOML config and normalizes confidence threshold', async () => {
    const configPath = writeTempToml(
      'config-a.toml',
      `
[ai]
provider = "openai"
openai_model = "gpt-4o-mini"
codex_model = "gpt-5-mini"
openai_api_key = "file-key"

[ai.review]
max_revisions = 11
confidence_threshold = 9.7

[server]
port = 9011
port_scan_span = 5
      `.trim(),
    );

    await withEnv(
      {
        SENSEBOARD_CONFIG: configPath,
      },
      async () => {
        const runtimeConfig = (await loadRuntimeConfigModule()).getRuntimeConfig();
        expect(runtimeConfig.ai.provider).toBe('openai');
        expect(runtimeConfig.ai.openaiModel).toBe('gpt-4o-mini');
        expect(runtimeConfig.ai.codexModel).toBe('gpt-5-mini');
        expect(runtimeConfig.ai.openaiApiKey).toBe('file-key');
        expect(runtimeConfig.ai.review.maxRevisions).toBe(11);
        expect(runtimeConfig.ai.review.confidenceThreshold).toBeCloseTo(0.97, 5);
        expect(runtimeConfig.server.port).toBe(9011);
        expect(runtimeConfig.server.portScanSpan).toBe(5);
        expect(runtimeConfig.sourcePath?.endsWith('config-a.toml')).toBe(true);
      },
    );
  });

  it('lets environment variables override TOML settings', async () => {
    const configPath = writeTempToml(
      'config-b.toml',
      `
[ai]
provider = "deterministic"
openai_model = "from-file-openai"
codex_model = "from-file-codex"
openai_api_key = "from-file-key"

[ai.review]
max_revisions = 2
confidence_threshold = 0.7

[server]
port = 9000
port_scan_span = 2
      `.trim(),
    );

    await withEnv(
      {
        SENSEBOARD_CONFIG: configPath,
        AI_PROVIDER: 'codex_cli',
        OPENAI_MODEL: 'from-env-openai',
        CODEX_MODEL: 'from-env-codex',
        OPENAI_API_KEY: 'from-env-key',
        PORT: '9101',
        PORT_SCAN_SPAN: '12',
        AI_REVIEW_MAX_REVISIONS: '33',
        AI_REVIEW_CONFIDENCE_THRESHOLD: '8.6',
      },
      async () => {
        const runtimeConfig = (await loadRuntimeConfigModule()).getRuntimeConfig();
        expect(runtimeConfig.ai.provider).toBe('codex_cli');
        expect(runtimeConfig.ai.openaiModel).toBe('from-env-openai');
        expect(runtimeConfig.ai.codexModel).toBe('from-env-codex');
        expect(runtimeConfig.ai.openaiApiKey).toBe('from-env-key');
        expect(runtimeConfig.server.port).toBe(9101);
        expect(runtimeConfig.server.portScanSpan).toBe(12);
        expect(runtimeConfig.ai.review.maxRevisions).toBe(33);
        expect(runtimeConfig.ai.review.confidenceThreshold).toBeCloseTo(0.86, 5);
      },
    );
  });

  it('falls back to defaults for invalid provider and numeric values', async () => {
    const configPath = writeTempToml(
      'config-c.toml',
      `
[ai]
provider = "unknown"

[ai.review]
max_revisions = 0
confidence_threshold = 24

[server]
port = -100
port_scan_span = 0
      `.trim(),
    );

    await withEnv(
      {
        SENSEBOARD_CONFIG: configPath,
        AI_PROVIDER: 'still-bad',
        PORT: '0',
        PORT_SCAN_SPAN: '-7',
        AI_REVIEW_MAX_REVISIONS: '0',
        AI_REVIEW_CONFIDENCE_THRESHOLD: '-1',
      },
      async () => {
        const runtimeConfig = (await loadRuntimeConfigModule()).getRuntimeConfig();
        expect(runtimeConfig.ai.provider).toBe('auto');
        expect(runtimeConfig.server.port).toBe(8787);
        expect(runtimeConfig.server.portScanSpan).toBe(8);
        expect(runtimeConfig.ai.review.maxRevisions).toBe(20);
        expect(runtimeConfig.ai.review.confidenceThreshold).toBe(0.98);
      },
    );
  });
});
