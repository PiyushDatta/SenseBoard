import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
const examplePath = resolve(process.cwd(), '.env.example');

if (!existsSync(envPath)) {
  console.error(`Missing required env file: ${envPath}`);
  console.error('Copy .env.example to .env and fill in your values.');
  console.error('PowerShell: Copy-Item .env.example .env');
  console.error('bash/zsh: cp .env.example .env');

  if (!existsSync(examplePath)) {
    console.error(`Also missing template file: ${examplePath}`);
  }
  process.exit(1);
}

console.log('Environment check passed (.env found).');
