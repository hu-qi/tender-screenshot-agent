import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadHostEnv(): void {
  const file = process.env.TENDER_ENV_FILE || join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const source of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^TENDER_[A-Z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
    const raw = line.slice(separator + 1).trim();
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
