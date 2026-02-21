import { runAiPreflightCheck } from './ai-engine';
import { getRuntimeConfig } from './runtime-config';
import { runTranscriptionPreflightCheck } from './transcription';

interface CodexProbe {
  installed: boolean;
  loggedIn: boolean;
}

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
