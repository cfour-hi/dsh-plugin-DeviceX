#!/usr/bin/env node
/**
 * Device X — build-engine conformance.
 *
 * The engineering review asked for B (bundler), C (no-bundler fallback) and D
 * (zero-build committed artifact) to coexist. This script proves they do:
 *
 *  - B: esbuild build is deterministic and current with the committed artifact;
 *  - C: the dependency-free node-concat build is deterministic, structurally a
 *       module-loader bundle, and renders identically (10 tabs + Windows data);
 *  - D: the committed plugin/client.js is self-contained — it loads with only
 *       the loader stub and the `react` seed, no sibling files or bundler;
 *  - all three expose the same registration surface (inject, slots, dictionaries).
 *
 * Usage: node scripts/verify-build.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const node = process.execPath;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}${detail === undefined ? '' : ` (${detail})`}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}
function run(script, args = [], env = {}) {
  return execFileSync(node, [join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}
function render(script, clientFile) {
  const result = spawnSync(node, [join(root, 'scripts', script)], {
    cwd: root,
    env: { ...process.env, DEVICEX_CLIENT_FILE: clientFile },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const work = mkdtempSync(join(tmpdir(), 'devicex-build-'));
const files = {
  esbuildA: join(work, 'esbuild-a.js'),
  esbuildB: join(work, 'esbuild-b.js'),
  concatA: join(work, 'concat-a.js'),
  concatB: join(work, 'concat-b.js'),
  committed: join(root, 'plugin', 'client.js'),
};

try {
  // ------------------------------------------------------------------ builds
  section('1. Both build engines run and are deterministic');
  run('build-client.mjs', ['--out', files.esbuildA]);
  run('build-client.mjs', ['--out', files.esbuildB]);
  run('build-client-concat.mjs', ['--out', files.concatA]);
  run('build-client-concat.mjs', ['--out', files.concatB]);
  const esbuildCode = readFileSync(files.esbuildA, 'utf8');
  const concatCode = readFileSync(files.concatA, 'utf8');
  const committedCode = readFileSync(files.committed, 'utf8');
  check('esbuild build outputs a bundle', esbuildCode.length > 100_000, `${esbuildCode.length} B`);
  check('concat build outputs a bundle', concatCode.length > 100_000, `${concatCode.length} B`);
  check('esbuild build is deterministic', esbuildCode === readFileSync(files.esbuildB, 'utf8'));
  check('concat build is deterministic', concatCode === readFileSync(files.concatB, 'utf8'));
  check(
    'committed plugin/client.js is current with the esbuild build',
    committedCode === esbuildCode,
    'run npm run build if this fails',
  );

  // ------------------------------------------------------------ structural
  section('2. Both artifacts honour the single-file loader contract');
  for (const [label, code] of [
    ['esbuild', esbuildCode],
    ['concat', concatCode],
    ['committed', committedCode],
  ]) {
    check(`${label}: registers through window.__ModuleLoader__.load`, code.includes('window.__ModuleLoader__.load'));
    check(`${label}: registers id @cfour-hi/dsh-plugin-devicex`, code.includes('"@cfour-hi/dsh-plugin-devicex"') || code.includes("'@cfour-hi/dsh-plugin-devicex'"));
    // Count loader seed *calls* in code, not in comments/diagnostics: the
    // non-minified concat build keeps the jsx.js docs that mention require("react").
    const codeOnly = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const seedCalls = (codeOnly.match(/[A-Za-z0-9_$]+\("react"\)/g) ?? []).length;
    check(`${label}: asks the loader only for the react seed`, seedCalls === 1, `${seedCalls}`);
    check(`${label}: no ESM import/export syntax`, !/(^|\n)\s*(import|export)\s/.test(code));
    check(`${label}: no sibling-file imports or requires`, !/(?:from|require)\s*\(\s*["']\.\.?\//.test(code) && !/from\s+["']\.\.?\//.test(code));
  }

  // ---------------------------------------------------------- registration
  section('3. All three expose the same registration surface');
  check('committed artifact loads with only a loader stub (no bundler, no deps)', typeof loadArtifact(committedCode).registration?.factory === 'function');
  const surfaces = {
    esbuild: loadArtifact(esbuildCode),
    concat: loadArtifact(concatCode),
    committed: loadArtifact(committedCode),
  };
  const reference = surfaces.committed;
  for (const label of ['esbuild', 'concat']) {
    check(`${label}: same inject slots`, JSON.stringify(surfaces[label].inject) === JSON.stringify(reference.inject), JSON.stringify(reference.inject));
    check(`${label}: same main panel key`, surfaces[label].slots.main?.key === reference.slots.main?.key, reference.slots.main?.key);
    check(`${label}: same sidebar id/order`, surfaces[label].slots.sidebar?.id === reference.slots.sidebar?.id && surfaces[label].slots.sidebar?.order === reference.slots.sidebar?.order);
    const zh = Object.keys(surfaces[label].dicts.zh).sort().join('|');
    const en = Object.keys(surfaces[label].dicts.en).sort().join('|');
    check(`${label}: zh dictionary identical`, zh === Object.keys(reference.dicts.zh).sort().join('|'), `${Object.keys(reference.dicts.zh).length} keys`);
    check(`${label}: en dictionary identical`, en === Object.keys(reference.dicts.en).sort().join('|'), `${Object.keys(reference.dicts.en).length} keys`);
  }

  // --------------------------------------------------------------- renders
  section('4. The concat artifact renders the real UI (not just parses)');
  for (const [label, clientFile] of [
    ['esbuild artifact', files.esbuildA],
    ['concat artifact', files.concatA],
  ]) {
    const ui = render('render-check.mjs', clientFile);
    const uiLine = (ui.stdout.match(/assertions: (\d+), passed: (\d+), failed: (\d+)/) ?? []).join(' ');
    check(`${label}: 10-tab render suite passes`, ui.status === 0 && /failed: 0/.test(ui.stdout), uiLine || ui.stderr.slice(0, 120));
    const win = render('render-windows-check.mjs', clientFile);
    check(`${label}: Windows-data render passes`, win.status === 0 && /WINDOWS RENDER SCENARIO PASSED/.test(win.stdout), (win.stdout.match(/\((\d+) checks\)/) ?? [])[0] ?? win.stderr.slice(0, 120));
  }

  section('5. D — the committed artifact needs no build step at runtime');
  check(
    'plugin/client.js runs from the repository alone (no node_modules, no sibling files)',
    !/from\s+["']\.[^"']+["']/.test(committedCode) && !/require\(\s*["']\.[^"']+["']\s*\)/.test(committedCode),
  );
  check('plugin/client.js carries a generated-artifact banner', /generated from src\/client\/ by scripts\/build-client/.test(committedCode));
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ------------------------------------------------------------------ helpers
/**
 * Load one artifact through a loader stub and return its registration surface.
 * @param {string} code bundle source.
 */
function loadArtifact(code) {
  let registration = null;
  const windowStub = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  };
  const documentStub = {
    head: { appendChild() {} },
    createElement() {
      return { setAttribute() {}, textContent: '', parentNode: null };
    },
  };
  new Function('window', 'document', code)(windowStub, documentStub);
  const reactStub = {
    createElement: () => null,
    Fragment: 'Fragment',
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useCallback: (callback) => callback,
    Component: class {},
  };
  const client = registration.factory((spec) => {
    if (spec === 'react') return reactStub;
    throw new Error(`unexpected require: ${spec}`);
  });
  const dicts = {};
  const slots = {};
  client.apply({
    effect(callback) {
      callback();
      return () => {};
    },
    locale: {
      register(_ns, value) {
        Object.assign(dicts, value);
        return () => {};
      },
      bind() {
        return (key) => key;
      },
    },
    slots: {
      inject(_name, factory) {
        factory();
        return () => {};
      },
      register(options) {
        slots[options.name === 'main' ? 'main' : 'sidebar'] = options;
        return () => {};
      },
    },
  });
  return { registration, inject: client.inject, dicts, slots };
}

// ------------------------------------------------------------------- summary
console.log('');
if (failures.length > 0) {
  console.log(`FAILURES (${failures.length}): ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log(`ALL BUILD-ENGINE CHECKS PASSED — ${passed} checks`);
}
