import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root=new URL('..',import.meta.url).pathname;
const skip=new Set(['node_modules','.git','dist','target']);
const patterns=[/sk-[A-Za-z0-9_-]{20,}/,/(?:api[_-]?key|authorization|bearer)\s*[:=]\s*['\"]?[A-Za-z0-9._-]{20,}/i,/https?:\/\/\d+\.\d+\.\d+\.\d+[^\s'\"]*\/v1\s+[A-Fa-f0-9]{24,}/];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())await walk(p);else{const b=await readFile(p,'utf8').catch(()=>null);if(b&&patterns.some(x=>x.test(b)))throw new Error(`possible secret: ${p}`)}}}
await walk(root);console.log('Secret scan passed.');
