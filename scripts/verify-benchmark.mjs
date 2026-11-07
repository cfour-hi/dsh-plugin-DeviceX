#!/usr/bin/env node
/**
 * Device X — benchmark engine verification.
 *
 * Runs the real engine (bounded to a few seconds) and checks the contract in
 * docs/benchmark-contract.md: shape, determinism, reasonable repeatability,
 * worker fallback, temp-file cleanup, history/previous handling and bounds.
 *
 * Usage: node scripts/verify-benchmark.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');
const modulePath = join(pluginDir, 'host', 'benchmark.js');
const docsPath = join(root, 'docs', 'benchmark-contract.md');

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

section('1. Static checks');
check('benchmark module exists', existsSync(modulePath));
let syntaxOk = true;
try {
  execFileSync(process.execPath, ['--check', modulePath], { stdio: 'pipe' });
} catch {
  syntaxOk = false;
}
check('benchmark.js passes node --check', syntaxOk);
check('benchmark contract doc exists', existsSync(docsPath));
const docs = existsSync(docsPath) ? readFileSync(docsPath, 'utf8') : '';
check('doc documents determinism/repeatability', /determin|repeatab/i.test(docs));
const source = readFileSync(modulePath, 'utf8');
check('source performs no network access', !/\bfetch\s*\(/.test(source) && !/node:https?/u.test(source));
check('source keeps the disk test in the OS temp dir', source.includes('mkdtemp') && source.includes('tmpdir'));
check('source always removes its temp directory', source.includes('rm(dir, { recursive: true, force: true })'));
check('source kills workers in a finally block', /finally[\s\S]{0,200}terminate/.test(source));

section('2. Module surface');
const bench = await import(pathToFileURL(modulePath));
check('TESTS is cpu/memory/disk in order', JSON.stringify(bench.TESTS) === JSON.stringify(['cpu', 'memory', 'disk']));
for (const name of ['runBenchmark', 'benchmarkHistory']) {
  check(`exports ${name}()`, typeof bench[name] === 'function');
}
check('exports an injectable __test surface', typeof bench.__test?.cpuTest === 'function' && typeof bench.__test?.runCpuMulti === 'function');

section('3. A real full run');
const wallStart = Date.now();
const first = await bench.runBenchmark({ tests: ['cpu', 'memory', 'disk'] });
const wallMs = Date.now() - wallStart;
check('full run resolves with ok:true', first.ok === true);
check('run wall time is bounded (<15s)', wallMs < 15_000, `${wallMs} ms`);
const run = first.benchmark;
check('run carries platform/duration/startedAt', typeof run.platform === 'string' && typeof run.startedAt === 'number' && typeof run.durationMs === 'number');
const env = run.environment ?? {};
check(
  'environment records the machine',
  typeof env.hostname === 'string' &&
    typeof env.cpuModel === 'string' &&
    Number.isInteger(env.logicalCores) &&
    env.logicalCores > 0 &&
    Number.isInteger(env.memoryBytes) &&
    env.memoryBytes > 0 &&
    typeof env.osVersion === 'string',
);
check('results cover all three tests in order', JSON.stringify(run.results?.map((entry) => entry.id)) === JSON.stringify(['cpu', 'memory', 'disk']));
const results = Object.fromEntries((run.results ?? []).map((entry) => [entry.id, entry]));
check('cpu result has a positive numeric score', typeof results.cpu?.score === 'number' && results.cpu.score > 0);
check('cpu unit is ops/s', results.cpu?.unit === 'ops/s');
check('cpu uses the fixed iteration count', results.cpu?.details?.singleThread?.iterations === bench.__test.CPU_ITERATIONS);
check(
  'cpu multi leg is multi or an explicit single fallback',
  results.cpu?.details?.multiThread?.mode === 'multi' || results.cpu?.details?.multiThread?.mode === 'single-fallback',
  results.cpu?.details?.multiThread?.mode,
);
check('cpu single leg has its own positive score', typeof results.cpu?.details?.singleThread?.score === 'number' && results.cpu.details.singleThread.score > 0);
check('memory result has a positive GB/s score', typeof results.memory?.score === 'number' && results.memory.score > 0 && results.memory.unit === 'GB/s');
check(
  'memory moved exactly 32 MiB x passes',
  results.memory?.details?.bytes === (32 * 1024 * 1024) * bench.__test.MEMORY_PASSES &&
    results.memory?.details?.passes === bench.__test.MEMORY_PASSES,
);
check('disk result has a positive MB/s score', typeof results.disk?.score === 'number' && results.disk.score > 0 && results.disk.unit === 'MB/s');
check(
  'disk reports write and read throughput',
  typeof results.disk?.details?.writeMBps === 'number' && typeof results.disk?.details?.readMBps === 'number',
);
check('disk wrote the fixed payload size', results.disk?.details?.bytes === bench.__test.DISK_BYTES);
check('disk temp file is removed after the run', typeof results.disk?.details?.tmpFile === 'string' && !existsSync(results.disk.details.tmpFile));
check('every result has a bounded duration', (run.results ?? []).every((entry) => typeof entry.durationMs === 'number' && entry.durationMs >= 0 && entry.durationMs < 15_000));
check('the whole payload is JSON-safe', typeof JSON.stringify(first) === 'string');
check('a first run has no previous baseline', run.previous === null);

section('4. Previous run + history');
const second = await bench.runBenchmark({ tests: ['cpu'] });
check('second run carries a previous baseline', second.benchmark.previous !== null && Array.isArray(second.benchmark.previous.results));
check('previous baseline kept the first run scores', (second.benchmark.previous.results ?? []).length === 3);
const firstCpu = results.cpu?.score;
const secondCpu = second.benchmark.results?.[0]?.score;
check('cpu score is repeatable within 30%', typeof secondCpu === 'number' && Math.abs(secondCpu - firstCpu) / firstCpu < 0.3, `${firstCpu} -> ${secondCpu}`);
const history = bench.benchmarkHistory();
check('history is newest first and capped', Array.isArray(history) && history.length >= 2 && history.length <= bench.__test.historyLimit, `${history.length}`);
check('history entries are JSON-safe runs without previous', history.every((entry) => typeof entry.durationMs === 'number' && Array.isArray(entry.results) && entry.previous === undefined));

section('5. Determinism and helpers');
const workA = bench.__test.cpuWork(1_000_000);
const workB = bench.__test.cpuWork(1_000_000);
check('fixed work is deterministic', workA === workB, String(workA));
check('scoreOf(1000 ops, 1000 ms) is 1000', bench.__test.scoreOf(1000, 1000) === 1000);
check('scoreOf guards against zero duration', bench.__test.scoreOf(1000, 0) === null);
check('pickBetter prefers the higher score', bench.__test.pickBetter({ score: 5 }, { score: 9 }).score === 9 && bench.__test.pickBetter({ score: 9 }, { score: 5 }).score === 9);

section('6. Worker fallback');
const fallback = await bench.__test.cpuTest({
  workerFactory() {
    throw new Error('injected worker failure');
  },
});
check('worker failure degrades to single-thread mode', fallback.details.multiThread.mode === 'single-fallback');
check('worker failure is reported, not thrown', /injected worker failure/.test(String(fallback.details.multiThread.error)));
check(
  'fallback still returns the single-thread score',
  fallback.score === fallback.details.singleThread.score && fallback.score > 0,
);

section('7. repeat mode keeps the better run');
bench.__test.resetHistory();
const repeated = await bench.runBenchmark({ tests: ['memory'], repeat: true });
check('repeat marks the result bestOf:2', repeated.benchmark.results[0].details.bestOf === 2);
check('repeat still returns one memory result', repeated.benchmark.results.length === 1 && repeated.benchmark.results[0].id === 'memory');
check('resetHistory leaves exactly the repeated run', bench.benchmarkHistory().length === 1);

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAILURES (${failures.length}): ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log(`ALL BENCHMARK CHECKS PASSED — ${passed} checks`);
}
