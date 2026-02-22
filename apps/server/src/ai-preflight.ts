import { runAiPreflightCheck } from './ai-engine';
import { getRuntimeConfig } from './runtime-config';
import { runTranscriptionPreflightCheck } from './transcription';

interface CodexProbe {
  installed: boolean;
  loggedIn: boolean;
}

interface ServerHealthProbe {
  url: string;
  startedAt: number;
}

const REQUEST_TIMEOUT_MS = 1200;
const WS_ACK_TIMEOUT_MS = 4000;
const WS_PROTOCOL = 'senseboard-ws-v1';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getServerCandidates = (defaultPort: number, defaultSpan: number): string[] => {
  const explicitUrl = process.env.EXPO_PUBLIC_SERVER_URL?.trim().replace(/\/+$/, '');
  if (explicitUrl) {
    return [explicitUrl];
  }
  const startPort = parsePositiveInt(process.env.EXPO_PUBLIC_SERVER_PORT, defaultPort);
  const span = parsePositiveInt(process.env.EXPO_PUBLIC_SERVER_PORT_SPAN, defaultSpan);
  const candidates: string[] = [];
  for (let offset = 0; offset < span; offset += 1) {
    candidates.push(`http://localhost:${startPort + offset}`);
  }
  return candidates;
};

const probeServerHealth = async (baseUrl: string): Promise<ServerHealthProbe | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as { instanceStartedAt?: unknown };
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

const resolveHandshakeServerUrl = async (defaultPort: number, defaultSpan: number): Promise<string | null> => {
  const candidates = getServerCandidates(defaultPort, defaultSpan);
  const probes = await Promise.all(candidates.map((candidate) => probeServerHealth(candidate)));
  const reachable = probes.filter((probe): probe is ServerHealthProbe => probe !== null);
  if (reachable.length === 0) {
    return null;
  }
  let best = reachable[0]!;
  for (let index = 1; index < reachable.length; index += 1) {
    const candidate = reachable[index]!;
    if (candidate.startedAt > best.startedAt) {
      best = candidate;
    }
  }
  return best.url;
};

const randomPreflightRoomId = (): string => {
  const token = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PREFLT${token}`;
};

const runWebsocketHandshakePreflight = async (baseUrl: string): Promise<{ ok: boolean; error?: string }> => {
  return new Promise((resolve) => {
    const roomId = randomPreflightRoomId();
    const wsBase = baseUrl.replace(/^http/i, 'ws');
    const params = new URLSearchParams({
      roomId,
      name: 'Preflight',
    });
    const wsUrl = `${wsBase}/ws?${params.toString()}`;

    let settled = false;
    let socket: WebSocket | null = null;

    const settle = (ok: boolean, error?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        socket?.close();
      } catch {
        // no-op
      }
      resolve({ ok, error });
    };

    const timeout = setTimeout(() => {
      settle(false, `WebSocket ACK timeout after ${WS_ACK_TIMEOUT_MS}ms (${wsUrl})`);
    }, WS_ACK_TIMEOUT_MS);

    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      resolve({ ok: false, error: `Failed to open websocket: ${message}` });
      return;
    }

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'client:ack',
          payload: {
            protocol: WS_PROTOCOL,
            sentAt: Date.now(),
          },
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: {
            protocol?: string;
            message?: string;
          };
        };
        if (message.type === 'server:ack' && message.payload?.protocol === WS_PROTOCOL) {
          settle(true);
          return;
        }
        if (message.type === 'room:error') {
          settle(false, message.payload?.message || 'Server returned room:error during handshake.');
        }
      } catch {
        settle(false, 'Invalid JSON message during websocket handshake preflight.');
      }
    };

    socket.onerror = () => {
      settle(false, `WebSocket error during handshake preflight (${wsUrl})`);
    };

    socket.onclose = () => {
      if (!settled) {
        settle(false, 'WebSocket closed before server ACK.');
      }
    };
  });
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
    normalized.includes('please log in') ||
    normalized.includes('not authenticated')
  ) {
    return false;
  }
  return normalized.includes('logged in') || normalized.includes('authenticated');
};

const probeCodex = (): CodexProbe => {
  try {
    const version = Bun.spawnSync({
      cmd: ['codex', '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 3000,
    });
    if (version.exitCode !== 0) {
      return { installed: false, loggedIn: false };
    }
  } catch {
    return { installed: false, loggedIn: false };
  }

  try {
    const status = Bun.spawnSync({
      cmd: ['codex', 'login', 'status'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    });
    const stdout = status.stdout ? new TextDecoder().decode(status.stdout).toLowerCase() : '';
    const stderr = status.stderr ? new TextDecoder().decode(status.stderr).toLowerCase() : '';
    const output = `${stdout}\n${stderr}`;
    return {
      installed: true,
      loggedIn: isCodexLoggedIn(status.exitCode, output),
    };
  } catch {
    return { installed: true, loggedIn: false };
  }
};

const runCodexLogin = async (): Promise<boolean> => {
  try {
    const proc = Bun.spawn({
      cmd: ['codex', 'login'],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
};

const main = async () => {
  const config = getRuntimeConfig();
  if (!config.preflight.enabled) {
    console.log('AI preflight skipped (preflight.enabled=false in senseboard.config.toml).');
    return;
  }

  const handshakeServerUrl = await resolveHandshakeServerUrl(config.server.port, config.server.portScanSpan);
  if (!handshakeServerUrl) {
    const candidates = getServerCandidates(config.server.port, config.server.portScanSpan).join(', ');
    console.error('Realtime handshake preflight failed: no reachable SenseBoard server.');
    console.error(`Checked: ${candidates}`);
    console.error('Start the server first with: bun run server');
    process.exit(1);
  }

  const handshake = await runWebsocketHandshakePreflight(handshakeServerUrl);
  if (!handshake.ok) {
    console.error(`Realtime handshake preflight failed on ${handshakeServerUrl}`);
    if (handshake.error) {
      console.error(handshake.error);
    }
    process.exit(1);
  }
  console.log(`Realtime handshake preflight ok (${handshakeServerUrl})`);

  const provider = config.ai.provider;
  const codexPrimary =
    provider === 'codex_cli' ||
    (provider === 'auto' && !config.ai.openaiApiKey && !config.ai.anthropicApiKey);

  if (codexPrimary) {
    const codex = probeCodex();
    if (!codex.installed) {
      console.error('Codex CLI was not found.');
      console.error('Install it with: npm i -g @openai/codex');
      console.error('OR: bun install -g @openai/codex');
      process.exit(1);
    }
    if (!codex.loggedIn) {
      console.log('Codex CLI is installed but not authenticated.');
      console.log('Starting `codex login` now; this should open your browser for authentication.');
      const loginOk = await runCodexLogin();
      if (!loginOk) {
        console.error('Codex login did not complete successfully.');
        process.exit(1);
      }
    }
  }

  const mainResult = await runAiPreflightCheck();
  if (!mainResult.ok && codexPrimary) {
    console.error('Codex appears installed/authenticated, but AI preflight still failed.');
    console.error('Try running: codex login status');
    console.error('If needed, re-authenticate with: codex login');
  }

  if (!mainResult.ok) {
    console.error(`Main AI preflight failed (provider: ${mainResult.provider}, configured: ${config.ai.provider})`);
    if (mainResult.error) {
      console.error(mainResult.error);
    }
    process.exit(1);
  }

  const transcriptionResult = await runTranscriptionPreflightCheck();
  if (!transcriptionResult.ok) {
    console.error(
      `Transcription preflight failed (provider: ${transcriptionResult.provider}, configured: ${config.ai.provider})`,
    );
    if (transcriptionResult.error) {
      console.error(transcriptionResult.error);
    }
    process.exit(1);
  }

  const mainResponder = mainResult.resolvedProvider ?? 'unknown';
  const transcriptionResponder = transcriptionResult.resolvedProvider ?? 'unknown';
  console.log(`Main AI preflight ok (route: ${mainResult.provider}, resolved: ${mainResponder})`);
  console.log(`Main AI response [${mainResponder}]: ${mainResult.response ?? ''}`);
  console.log(
    `Transcription preflight ok (route: ${transcriptionResult.provider}, resolved: ${transcriptionResponder})`,
  );
  console.log(`Transcription response [${transcriptionResponder}]: ${transcriptionResult.response ?? ''}`);
};

void main();
