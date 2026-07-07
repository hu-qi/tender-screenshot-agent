import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const skip = new Set(['node_modules', '.git', 'dist', 'target']);
const patterns = [
  { name: 'openai-style-key', value: /sk-[A-Za-z0-9_-]{20,}/ },
  {
    name: 'named-key-or-header',
    // A value is either a quoted literal or an unquoted token. The unquoted alternative explicitly
    // excludes source references such as `apiKey: env.TENDER_LLM_API_KEY`.
    value: /(?:api[_-]?key|authorization|bearer)\s*[:=]\s*(?:['"][A-Za-z0-9._-]{20,}['"]|(?![A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)[A-Za-z0-9._-]{20,})/i,
  },
  { name: 'inline-ip-endpoint-token', value: /https?:\/\/\d+\.\d+\.\d+\.\d+[^\s'"]*\/v1\s+[A-Fa-f0-9]{24,}/ },
];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    const body = await readFile(path, 'utf8').catch(() => null);
    if (!body) continue;
    for (const pattern of patterns) {
      const match = pattern.value.exec(body);
      if (!match) continue;
      const line = body.slice(0, match.index).split(/\r?\n/).length;
      throw new Error(`possible secret (${pattern.name}) in ${relative(root, path)}:${line}`);
    }
  }
}

await walk(root);
console.log('Secret scan passed.');
