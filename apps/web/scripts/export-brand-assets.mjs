#!/usr/bin/env node
/**
 * Writes the static brand files from the single source of truth (src/lib/brand-art.ts):
 *   public/brand/*.svg  logo variants, symbol, app icon and the seven ORBI expressions
 *   src/app/icon.svg    the favicon picked up by the Next.js icon file convention
 *
 * Run from apps/web:  pnpm brand:export
 * (Node 22 type stripping imports the TypeScript module directly; no build step needed.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const art = await import('../src/lib/brand-art.ts');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'brand');
mkdirSync(out, { recursive: true });

const files = {
  'orchestra-symbol.svg': art.symbolSvg(),
  'orchestra-symbol-mono.svg': art.symbolSvg({ mono: true, id: 'orchestra-symbol-mono' }),
  'orchestra-logo-light.svg': art.logoSvg('light'),
  'orchestra-logo-dark.svg': art.logoSvg('dark'),
  'orchestra-logo-mono.svg': art.logoSvg('mono'),
  'orchestra-app-icon.svg': art.appIconSvg(),
  ...Object.fromEntries(art.ORBI_EXPRESSIONS.map((expression) => [`orbi-${expression}.svg`, art.orbiSvg(expression)])),
};

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(path.join(out, name), svg);
  console.log(`public/brand/${name}`);
}
writeFileSync(path.join(root, 'src', 'app', 'icon.svg'), art.appIconSvg());
console.log('src/app/icon.svg');
