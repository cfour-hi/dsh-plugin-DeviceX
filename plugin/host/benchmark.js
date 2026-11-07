/**
 * Device X — repeatable benchmark engine.
 *
 * Three fixed-work tests, deliberately *not* a "score for the internet": the
 * same amount of work is executed on every run and every machine, so the
 * numbers are stable enough to compare a machine against itself (before/after a
 * driver update, a thermal throttle, a plug/unplug). There is no composite
 * weight, no fake normalization and no network call.
 *
 *  - cpu    fixed integer-mix work, once on one thread and once across
 *           `min(4, cores)` threads (worker_threads, with a single-thread
 *           fallback); score = operations / second.
 *  - memory fixed copy passes over two 32 MiB Float64Arrays;
 *           score = GB/s.
 *  - disk   fixed 64 MiB write + fsync + read under the OS temp dir;
 *           score = MB/s (write/read reported separately, score = mean).
 *
 * Every test is bounded, kills its workers, removes its temp file and never
 * throws: a failure becomes a result entry with an `error` string.
 *
 * @module @cfour-hi/dsh-devicex/host/benchmark
 */
import { cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

/** Benchmark ids, in execution order. */
export const TESTS = ['cpu', 'memory', 'disk'];

/** Fixed CPU iterations per leg (tuned for roughly 600-900 ms on Apple silicon). */
export const CPU_ITERATIONS = 70_000_000;

/** Fixed memory copy passes over the two 32 MiB arrays. */
export const MEMORY_PASSES = 48;

/** Fixed disk payload: write + fsync + read. */
export const DISK_BYTES = 64 * 1024 * 1024;

/** Disk IO block size. */
const DISK_BLOCK = 1024 * 1024;

/** Hard ceiling for one multi-thread CPU leg. */
const WORKER_TIMEOUT_MS = 20_000;

/** Runs kept in memory for the "previous run" comparison. */
const HISTORY_LIMIT = 5;

/** Newest-first history of completed runs (module lifetime only). */
const history = [];

/** Milliseconds with sub-ms precision. */
function now() {
  return performance.now();
}

/**
 * Integer-mix workload. The exact checksum is irrelevant; the fixed iteration
 * count is what makes the timing repeatable.
 * @param {number} iterations
 * @returns {number} last accumulator (for a cheap sanity check)
 */
function cpuWork(iterations) {
  let a = 0x9e3779b9 | 0;
  let b = 0x85ebca6b | 0;
  let c = iterations | 0;
  for (let i = 0; i < iterations; i += 1) {
    a = (a ^ Math.imul(b, 0x5bd1e995)) | 0;
    b = (b + Math.imul(a ^ (a >>> 15), 0x27d4eb2f)) | 0;
    c = (c ^ Math.imul(a + b, 0xc2b2ae35)) | 0;
  }
  return (a ^ b ^ c) >>> 0;
}

/**
 * Source of the worker-side CPU leg (kept as a string: no worker file needed).
 * The dynamic import keeps the eval worker valid whether the host treats eval
 * workers as CommonJS or as ESM.
 */
const CPU_WORKER_SOURCE = `
(async () => {
  const { parentPort, workerData } = await import('node:worker_threads');
  let a = 0x9e3779b9 | 0;
  let b = 0x85ebca6b | 0;
  let c = workerData.iterations | 0;
  for (let i = 0; i < workerData.iterations; i += 1) {
    a = (a ^ Math.imul(b, 0x5bd1e995)) | 0;
    b = (b + Math.imul(a ^ (a >>> 15), 0x27d4eb2f)) | 0;
    c = (c ^ Math.imul(a + b, 0xc2b2ae35)) | 0;
  }
  parentPort.postMessage((a ^ b ^ c) >>> 0);
})();
`;

/** Default worker factory (injected by the *_test_* hooks for failure tests). */
function defaultWorkerFactory(iterations) {
  return new Worker(CPU_WORKER_SOURCE, { eval: true, workerData: { iterations } });
}

/**
 * Run `count` worker legs plus the caller's own leg, all in parallel.
 * @param {{threads?:number, workerFactory?:Function}} [options]
 * @returns {Promise<{mode:string, threads:number, iterations:number, durationMs:number, checksum:number}>}
 */
async function runCpuMulti(options = {}) {
  const threads = Math.max(2, Math.floor(Number(options.threads) || 2));
  const factory = typeof options.workerFactory === 'function' ? options.workerFactory : defaultWorkerFactory;
  const iterations = CPU_ITERATIONS;
  const workers = [];
  let timer;
  const started = now();
  try {
    const legs = [];
    for (let index = 1; index < threads; index += 1) {
      const worker = factory(iterations);
      workers.push(worker);
      legs.push(
        new Promise((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited with code ${String(code)}`));
          });
        }),
      );
    }
    // The main thread is one of the legs too.
    const all = Promise.all(legs).then((values) => [cpuWork(iterations), ...values]);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('worker timeout')), WORKER_TIMEOUT_MS);
      timer.unref?.();
    });
    const values = await Promise.race([all, timeout]);
    const checksum = values.reduce((acc, value) => (acc ^ Number(value ?? 0)) >>> 0, 0);
    return { mode: 'multi', threads, iterations, durationMs: now() - started, checksum };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
  }
}

/**
 * CPU test: one leg single-threaded, then the best multi-core leg.
 * @returns {Promise<object>} result entry
 */
async function cpuTest(options = {}) {
  const startedAt = now();
  const singleStart = now();
  const singleChecksum = cpuWork(CPU_ITERATIONS);
  const singleMs = now() - singleStart;
  const single = {
    mode: 'single',
    threads: 1,
    iterations: CPU_ITERATIONS,
    durationMs: singleMs,
    score: scoreOf(CPU_ITERATIONS, singleMs),
    checksum: singleChecksum,
  };
  let multi;
  try {
    const threads = Math.max(2, Math.min(4, Math.max(2, cpus().length - 1)));
    const result = await runCpuMulti({ threads, workerFactory: options.workerFactory });
    multi = {
      mode: 'multi',
      threads: result.threads,
      iterations: result.iterations,
      durationMs: result.durationMs,
      score: scoreOf(result.iterations * result.threads, result.durationMs),
      checksum: result.checksum,
    };
  } catch (error) {
    multi = {
      mode: 'single-fallback',
      threads: 1,
      iterations: CPU_ITERATIONS,
      durationMs: singleMs,
      score: single.score,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  // Aggregate: multi-core score is the headline number; keep both legs in details.
  const details = { singleThread: single, multiThread: multi };
  return {
    id: 'cpu',
    durationMs: Math.round(now() - startedAt),
    score: multi?.score ?? single.score,
    unit: 'ops/s',
    details,
  };
}

/** Ops-per-second score with a duration guard. */
function scoreOf(operations, durationMs) {
  const seconds = Number(durationMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(Number(operations) / seconds);
}

/**
 * Memory bandwidth test: copy between two 32 MiB arrays, fixed pass count.
 * @returns {object} result entry
 */
function memoryTest() {
  const startedAt = now();
  const elements = (32 * 1024 * 1024) / Float64Array.BYTES_PER_ELEMENT;
  const a = new Float64Array(elements);
  const b = new Float64Array(elements);
  for (let index = 0; index < elements; index += 1) a[index] = index % 97;
  const start = now();
  for (let pass = 0; pass < MEMORY_PASSES; pass += 1) {
    const source = pass % 2 === 0 ? a : b;
    const target = pass % 2 === 0 ? b : a;
    for (let index = 0; index < elements; index += 1) target[index] = source[index] + pass;
  }
  const durationMs = now() - start;
  const bytes = elements * Float64Array.BYTES_PER_ELEMENT * MEMORY_PASSES;
  return {
    id: 'memory',
    durationMs: Math.round(now() - startedAt),
    score: round(Number(bytes) / 1e9 / (durationMs / 1000), 2),
    unit: 'GB/s',
    details: {
      bytes,
      passes: MEMORY_PASSES,
      megabytes: Math.round(bytes / (1024 * 1024)),
      checksum: round(a[0] + b[0], 6),
    },
  };
}

/** Round to `digits`, or null for a non-finite value. */
function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Disk test: one 64 MiB file, serial write with fsync, then read back.
 * @returns {Promise<object>} result entry
 */
async function diskTest() {
  const startedAt = now();
  const dir = await mkdtemp(join(tmpdir(), 'devicex-bench-'));
  const file = join(dir, 'bench.bin');
  const block = Buffer.alloc(DISK_BLOCK, 0x5a);
  const blocks = DISK_BYTES / DISK_BLOCK;
  try {
    const writeStart = now();
    const handle = await open(file, 'w');
    try {
      for (let index = 0; index < blocks; index += 1) {
        let offset = 0;
        while (offset < block.length) {
          const { bytesWritten } = await handle.write(block, offset, block.length - offset);
          if (!bytesWritten) throw new Error('short write');
          offset += bytesWritten;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const writeMs = now() - writeStart;

    const readStart = now();
    const readHandle = await open(file, 'r');
    const buffer = Buffer.alloc(DISK_BLOCK);
    let readBytes = 0;
    try {
      let position = 0;
      for (;;) {
        const { bytesRead } = await readHandle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        readBytes += bytesRead;
      }
    } finally {
      await readHandle.close();
    }
    const readMs = now() - readStart;
    const size = (await stat(file)).size;
    if (size !== DISK_BYTES || readBytes !== DISK_BYTES) {
      throw new Error(`size mismatch: ${String(size)} / ${String(readBytes)}`);
    }
    const writeMBps = round(DISK_BYTES / (1024 * 1024) / (writeMs / 1000), 1);
    const readMBps = round(DISK_BYTES / (1024 * 1024) / (readMs / 1000), 1);
    return {
      id: 'disk',
      durationMs: Math.round(now() - startedAt),
      score: round(((writeMBps ?? 0) + (readMBps ?? 0)) / 2, 1),
      unit: 'MB/s',
      details: {
        bytes: DISK_BYTES,
        writeMBps,
        readMBps,
        writeMs: Math.round(writeMs),
        readMs: Math.round(readMs),
        tmpFile: file,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Actually run one test by id; failures are contained per test.
 * @param {string} id
 * @returns {Promise<object>}
 */
async function runTest(id) {
  try {
    if (id === 'cpu') return await cpuTest();
    if (id === 'memory') return memoryTest();
    if (id === 'disk') return await diskTest();
    return { id, durationMs: 0, score: null, unit: '', details: {}, error: `unknown test: ${String(id)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, durationMs: 0, score: null, unit: id === 'memory' ? 'GB/s' : id === 'disk' ? 'MB/s' : 'ops/s', details: {}, error: message };
  }
}

/** Collect the machine facts every run records. */
function environment() {
  const logicalCores = Math.max(1, cpus().length);
  return {
    hostname: hostname(),
    cpuModel: cpus()[0]?.model ?? null,
    logicalCores,
    physicalCores: null,
    memoryBytes: totalmem(),
    osVersion: `${platform()} ${release()}`,
  };
}

/**
 * Execute the benchmark suite.
 *
 * @param {{tests?: string[], repeat?: boolean}} [options] tests subset to run,
 *   repeat keeps the better of two runs per test.
 * @returns {Promise<{ok:true, benchmark:object}>}
 */
export async function runBenchmark(options = {}) {
  const requestedTests = Array.isArray(options.tests) ? options.tests : [];
  const requested = requestedTests.length > 0
    ? TESTS.filter((id) => requestedTests.includes(id))
    : TESTS;
  const repeat = options.repeat === true;
  const startedAt = Date.now();
  const start = now();
  const previousRun = history[0];
  const previous = previousRun
    ? { at: previousRun.startedAt, results: previousRun.results.map((entry) => ({ id: entry.id, score: entry.score, unit: entry.unit })) }
    : null;
  const results = [];
  for (const id of requested.length > 0 ? requested : TESTS) {
    if (!repeat) {
      results.push(await runTest(id));
      continue;
    }
    // Keep the better (higher score) of two runs; record that in details.
    const first = await runTest(id);
    const second = await runTest(id);
    const better = pickBetter(first, second);
    better.details = { ...(better.details ?? {}), bestOf: 2 };
    results.push(better);
  }
  const run = {
    platform: process.platform,
    startedAt,
    durationMs: Math.round(now() - start),
    environment: environment(),
    results,
  };
  history.unshift(run);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  return { ok: true, benchmark: { ...run, previous } };
}

/** Higher numeric score wins; errors lose. */
function pickBetter(first, second) {
  const firstScore = typeof first?.score === 'number' ? first.score : -Infinity;
  const secondScore = typeof second?.score === 'number' ? second.score : -Infinity;
  return secondScore > firstScore ? second : first;
}

/**
 * Recent runs, newest first (the same shape as `benchmark` minus `previous`).
 * @returns {object[]}
 */
export function benchmarkHistory() {
  return history.map((run) => JSON.parse(JSON.stringify(run)));
}

/** Test hooks (pure helpers + injectable worker factory). */
export const __test = {
  cpuWork,
  cpuTest,
  memoryTest,
  diskTest,
  runCpuMulti,
  scoreOf,
  pickBetter,
  environment,
  resetHistory() {
    history.length = 0;
  },
  historyLimit: HISTORY_LIMIT,
  CPU_ITERATIONS,
  MEMORY_PASSES,
  DISK_BYTES,
};
