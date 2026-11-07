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
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const sourceDir = join(root, 'src', 'client');
const manifest = JSON.parse(readFileSync(join(root, 'plugin', 'package.json'), 'utf8'));

/** Module order matters: later modules use names declared by earlier ones. */
const MODULE_ORDER = [
  'runtime.js',
  'hooks.js',
  'constants.js',
  'helpers.js',
  'dicts.js',
  'styles.js',
  'normalizers.js',
  'api.js',
  'jsx.js',
  'components/Icon.tsx',
  'components/EmptyState.tsx',
  'components/Fact.tsx',
  'components/FactGrid.tsx',
  'components/DataTable.tsx',
  'components/Skeleton.tsx',
  'components/Card.tsx',
  'components/Pill.tsx',
  'components/SignalBars.tsx',
  'components/Switch.tsx',
  'components/Donut.tsx',
  'components/Sparkline.tsx',
  'components/Bar.tsx',
  'components/SectionHead.tsx',
  'components/SubCard.tsx',
  'components/SearchField.tsx',
  'components/SegmentedControl.tsx',
  'components/ErrorState.tsx',
  'components/KpiCard.tsx',
  'components/SectionErrors.tsx',
  'components/TabShell.tsx',
  'components/ThermalCard.tsx',
  'components/DriversCard.tsx',
  'components/HardwareTab.tsx',
  'components/DeviceScene.tsx',
  'components/OverviewTab.tsx',
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

/**
 * Read one module. `.ts`/`.tsx` are transpiled with the TypeScript compiler
 * (no bundler involved) using the same classic-JSX factory as the esbuild
 * build, so the concat fallback can handle TSX components too.
 * @param {string} file
 * @returns {string}
 */
function readModuleSource(file) {
  const raw = readFileSync(join(sourceDir, file), 'utf8');
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return raw;
  const transpiled = ts.transpileModule(raw, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
    },
    fileName: file,
  });
  return transpiled.outputText;
}

const modules = MODULE_ORDER.map((file) => {
  const source = readModuleSource(file);
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
