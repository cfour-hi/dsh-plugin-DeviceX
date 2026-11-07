# Benchmark contract (Device X 1.2)

Status: frozen for `plugin/host/benchmark.js` and the browser route
`POST /devicex/api/benchmark`.

## Purpose

A **repeatable** local benchmark, not an internet score. Every run executes the
same fixed amount of work, so the numbers are meaningful when compared on the
same machine over time (thermal throttle, driver update, power mode, a fan that
stopped). They are *not* comparable across CPU architectures and are not tuned
to match any third-party scoring system.

## API

`plugin/host/benchmark.js` exports:

- `TESTS = ['cpu','memory','disk']`
- `runBenchmark({ tests = [], repeat = false } = {})`
  returns `{ ok: true, benchmark }`
- `benchmarkHistory()` — last ≤ 5 completed runs, newest first
- `__test` — pure helpers + an injectable worker factory (tests only)

`benchmark` shape:

```js
{
  platform: 'darwin' | 'win32',
  startedAt: number,            // epoch ms
  durationMs: number,           // whole suite
  environment: {
    hostname, cpuModel, logicalCores, physicalCores, // physicalCores is null when unknown
    memoryBytes, osVersion
  },
  results: [
    { id: 'cpu',    durationMs, score, unit: 'ops/s', details },
    { id: 'memory', durationMs, score, unit: 'GB/s',  details },
    { id: 'disk',   durationMs, score, unit: 'MB/s',  details }
  ],
  previous: null | { at: number, results: [{ id, score, unit }] }
}
```

Any failed test is still a result entry with `score: null` and an `error`
string; the suite never rejects.

## Fixed work and scoring

| test | fixed work | score |
| --- | --- | --- |
| cpu | 70,000,000 iterations of an integer mix per leg; one single-thread leg plus one leg across `min(4, cores)` threads | `operations / second` (multi-core aggregate; `details.singleThread` keeps the one-core number) |
| memory | 48 copy passes over two 32 MiB `Float64Array`s | `GB/s` (bytes copied / second) |
| disk | one 64 MiB file under `os.tmpdir()`: write + `fsync`, then read, then delete | `MB/s` (mean of write/read; both in `details`) |

Worker legs use `worker_threads` with a hard 20 s timeout, are always
terminated, and degrade to the single-thread result (`mode:
'single-fallback'`) whenever spawning or messaging fails. The disk temp file is
removed in a `finally` block.

`repeat: true` runs every requested test twice and keeps the better score
(`details.bestOf = 2`).

## Determinism and tolerance

The workload is constant, so repeated runs on an idle machine stay within a few
percent. The verification script asserts a 30 % ceiling, which is deliberately
loose enough to survive a machine under load and still catch a broken clock or
a workload that silently shrank. The absolute score depends on the machine and
current load — treat it as a relative indicator, not a product rating.

## Browser route

`POST /devicex/api/benchmark` (same Connection trust fence as every other
DeviceX route), JSON body `{ tests?: string[], repeat?: boolean }`, response
`{ ok: true, benchmark }`. Unknown test ids are ignored; no test ids means all
three.
