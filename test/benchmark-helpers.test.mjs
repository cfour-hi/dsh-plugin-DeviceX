import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const bench = await import('../plugin/host/benchmark.js');
const { __test: helpers } = bench;

/* -------------------------------------------------------------------- CPU */

test('cpuWork is deterministic and returns a finite checksum', () => {
  const first = helpers.cpuWork(1_000_000);
  const second = helpers.cpuWork(1_000_000);
  assert.equal(first, second);
  assert.equal(typeof first, 'number');
  assert.ok(Number.isInteger(first));
  assert.ok(first >= 0);
});

test('scoreOf reports ops/s and guards against invalid durations', () => {
  assert.equal(helpers.scoreOf(1000, 1000), 1000);
  assert.equal(helpers.scoreOf(1_000_000, 500), 2_000_000);
  assert.equal(helpers.scoreOf(1000, 0), null);
  assert.equal(helpers.scoreOf(1000, Number.NaN), null);
});

test('pickBetter keeps the higher score and tolerates failures', () => {
  assert.equal(helpers.pickBetter({ score: 5 }, { score: 9 }).score, 9);
  assert.equal(helpers.pickBetter({ score: 9 }, { score: 5 }).score, 9);
  assert.equal(helpers.pickBetter({ score: 5 }, { score: null }).score, 5);
});

/* ----------------------------------------------------------------- memory */

test('memoryTest moves exactly 32 MiB per pass', () => {
  const result = helpers.memoryTest();
  assert.equal(result.id, 'memory');
  assert.equal(result.unit, 'GB/s');
  assert.ok(result.score > 0);
  assert.equal(result.details.passes, helpers.MEMORY_PASSES);
  assert.equal(result.details.bytes, 32 * 1024 * 1024 * helpers.MEMORY_PASSES);
  assert.ok(result.durationMs >= 0);
});

/* ------------------------------------------------------------------- disk */

test('diskTest writes, reads and removes its temp file', async () => {
  const result = await helpers.diskTest();
  assert.equal(result.id, 'disk');
  assert.equal(result.unit, 'MB/s');
  assert.ok(result.score > 0);
  assert.ok(result.details.writeMBps > 0);
  assert.ok(result.details.readMBps > 0);
  assert.equal(result.details.bytes, helpers.DISK_BYTES);
  assert.equal(typeof result.details.tmpFile, 'string');
  assert.equal(existsSync(result.details.tmpFile), false, 'temp file is removed');
});

/* ------------------------------------------------------------- runBenchmark */

test('runBenchmark runs a requested subset and records a baseline', async () => {
  helpers.resetHistory();
  const first = await bench.runBenchmark({ tests: ['memory'] });
  assert.equal(first.ok, true);
  assert.equal(first.benchmark.platform, process.platform);
  assert.deepEqual(first.benchmark.results.map((result) => result.id), ['memory']);
  assert.equal(first.benchmark.previous, null);
  assert.equal(typeof first.benchmark.durationMs, 'number');
  assert.equal(typeof first.benchmark.environment.logicalCores, 'number');
  assert.equal(typeof JSON.stringify(first), 'string');

  const second = await bench.runBenchmark({ tests: ['memory'] });
  assert.ok(second.benchmark.previous !== null);
  assert.equal(second.benchmark.previous.results.length, 1);
  assert.equal(second.benchmark.previous.results[0].id, 'memory');
  assert.equal(typeof second.benchmark.previous.at, 'number');
});

test('benchmarkHistory keeps newest first and tolerates reset', () => {
  const history = bench.benchmarkHistory();
  assert.ok(Array.isArray(history));
  assert.ok(history.length >= 1 && history.length <= helpers.historyLimit);
  assert.equal(history[0].previous, undefined);
  helpers.resetHistory();
  assert.deepEqual(bench.benchmarkHistory(), []);
});

test('worker failure degrades to the single-thread result', async () => {
  const fallback = await helpers.cpuTest({
    workerFactory() {
      throw new Error('injected worker failure');
    },
  });
  assert.equal(fallback.details.multiThread.mode, 'single-fallback');
  assert.match(String(fallback.details.multiThread.error), /injected worker failure/);
  assert.equal(fallback.score, fallback.details.singleThread.score);
  assert.ok(fallback.score > 0);
});
