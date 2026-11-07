#!/usr/bin/env node
/**
 * Zero-dependency fallback build for the browser half.
 *
 * This is the "option C" path from the engineering review: no bundler, no
 * devDependencies — just read the ordered ESM modules from `src/client/`,
 * strip their `import`/`export` syntax, concatenate them into one IIFE and
 * append the module-loader registration. It produces the same runtime contract
 * as the esbuild bundle, so it can be used on a machine (or a CI cache) where
 * npm devDependencies are unavailable.
 *
 * Usage:
 *   node scripts/build-client-concat.mjs                  # write plugin/client.js
 *   node scripts/build-client-concat.mjs --out <file>     # write elsewhere (verification)
 *   node scripts/build-client-concat.mjs --check          # compare with plugin/client.js
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const sourceDir = join(root, 'src', 'client');
const manifest = JSON.parse(readFileSync(join(root, 'plugin', 'package.json'), 'utf8'));

/** Module order matters: later modules use names declared by earlier ones. */
const MODULE_ORDER = [
  'runtime.js',
  'constants.js',
  'helpers.js',
  'dicts.js',
  'styles.js',
  'normalizers.js',
  'api.js',
  'core.js',
];

/** Arguments. */
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const outIndex = argv.indexOf('--out');
const outfile = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : join(root, 'plugin', 'client.js');

/**
 * Strip module syntax so the bodies can share one scope.
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function stripModuleSyntax(source, name) {
  let out = source;
  // Multi-line `import { … } from "./x.js";` blocks.
  out = out.replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, '');
  // `export { a, b };` / `export {\n a,\n b,\n};` blocks (can span lines).
  out = out.replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '');
  // `export function` / `export const` / `export class` / `export async function`.
  out = out.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  if (/(^|\n)\s*(import|export)\s/.test(out)) {
    throw new Error(`${name}: module syntax survived stripping`);
  }
  return out.trim();
}

const modules = MODULE_ORDER.map((file) => {
  const source = readFileSync(join(sourceDir, file), 'utf8');
  return { file, body: stripModuleSyntax(source, file) };
});

// Every top-level module-scope declaration must be unique once concatenated.
const declared = new Map();
for (const { file, body } of modules) {
  const pattern = /^(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    if (declared.has(name)) throw new Error(`duplicate top-level declaration "${name}" in ${declared.get(name)} and ${file}`);
    declared.set(name, file);
  }
}

const registration = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(manifest.name)},
\tfactory: (require) => {
\t\tsetReact(require("react"));
\t\treturn createClient();
\t},
});`;

const banner = `/* Device X client — generated from src/client/ by scripts/build-client-concat.mjs (no bundler). Do not edit. */`;
const code = `${banner}
(function () {
\t"use strict";
${modules.map(({ body }) => body).join('\n\n')}\n\n${registration}\n})();\n`;

// The bundle may only ask the loader for the platform seed.
const seedMatches = [...code.matchAll(/setReact\(\s*[A-Za-z0-9_$]+\("react"\)\s*\)/g)];
if (seedMatches.length !== 1) {
  console.error(`REFUSING TO WRITE: expected one react seed request, found ${seedMatches.length}`);
  process.exit(1);
}

if (check) {
  const current = existsSync(outfile) ? readFileSync(outfile, 'utf8') : '';
  if (current !== code) {
    console.error('plugin/client.js is stale: run `npm run build` (or `npm run build:concat`) and commit the result');
    process.exit(1);
  }
  console.log('plugin/client.js matches the concat build');
} else {
  writeFileSync(outfile, code);
  console.log(`built ${outfile} — ${code.length} bytes (concat, no bundler)`);
}
