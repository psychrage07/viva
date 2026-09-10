import { readdirSync,readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
it('engine imports nothing outside itself, no React, network, or Node built-ins',()=>{for(const file of readdirSync('src/lib/engine').filter(f=>f.endsWith('.ts'))){const text=readFileSync('src/lib/engine/'+file,'utf8');for(const match of text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g))expect(match[1].startsWith('./')).toBe(true);expect(text).not.toMatch(/\bfetch\s*\(|\brequire\s*\(|node:|process\.env|window\./);}});
