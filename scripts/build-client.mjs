#!/usr/bin/env node
/**
 * Build the browser half: bundle `src/client/` into the single-file
 * `plugin/client.js` that the Host serves to the DSH Web module loader.
 *
 * The client format is `window.__ModuleLoader__.load({ id, factory })`; esbuild
 * bundles the module tree into an IIFE and the loader's `react` seed stays
 * external (it is still requested through the factory's `require`).
 *
 * Usage:
 *   node scripts/build-client.mjs           # (re)generate plugin/client.js
 *   node scripts/build-client.mjs --check   # verify the committed bundle is current
 *   node scripts/build-client.mjs --out <file>  # write elsewhere (verification)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const outIndex = argv.indexOf('--out');
const outfile = outIndex >= 0 && argv[outIndex + 1]
  ? argv[outIndex + 1]
  : join(root, 'plugin', 'client.js');

const result = await build({
  entryPoints: [join(root, 'src', 'client', 'entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  // The loader injects React, so JSX must use the classic transform with the
  // local `h` wrapper (see src/client/jsx.js); never bundle react/jsx-runtime.
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  // The stylesheet is authored as plain CSS and compiled into the bundle as a
  // JS string; DSH loads browser plugins as JavaScript only (no CSS request).
  loader: { '.css': 'text' },
  legalComments: 'none',
  write: false,
  banner: {
    js: '/* Device X client — generated from src/client/ by scripts/build-client.mjs. Do not edit. */',
  },
});

const code = result.outputFiles[0].text.replace(/\r\n/g, '\n');

// The bundle may only ask the loader for the platform seed. esbuild renames
// the factory parameter when it detects a scope collision (e.g. `require2`),
// so validate the shape of the single seed request instead of the name.
const reactLiterals = (code.match(/"react"/g) ?? []).length;
const seedCalls = [...code.matchAll(/[A-Za-z0-9_$]+\(\s*"react"\s*\)/g)].length;
const otherRequests = code.match(/(?:__require|require\d*)\(\s*["']/g) ?? [];
if (reactLiterals !== 1 || seedCalls !== 1 || otherRequests.length > 0) {
  console.error(
    `REFUSING TO WRITE: unexpected platform seed requests (${JSON.stringify({ reactLiterals, seedCalls, otherRequests: otherRequests.length })})`,
  );
  process.exit(1);
}

if (check) {
  const current = existsSync(outfile) ? readFileSync(outfile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== code) {
    console.error('plugin/client.js is stale: run `npm run build` and commit the result');
    process.exit(1);
  }
  console.log('plugin/client.js matches src/client/');
} else {
  writeFileSync(outfile, code);
  console.log(`built plugin/client.js — ${code.length} bytes from src/client/`);
}
