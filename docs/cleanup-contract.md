# Cleanup contract (host API)

Status: stable host-side contract shared by macOS and Windows.

The cleanup surface is a bounded, allowlist-only disk-cleanup scanner plus a
confirmed deletion action. It never accepts a caller-supplied path: callers
pass **cleanup item ids**, and each id maps to one fixed absolute path in the
platform module (`cleanup-darwin.js` / `cleanup-win32.js`). Anything unknown,
relative, outside the allowlist, duplicated or beyond the per-request limit is
refused before a filesystem call.

Modules:

| file | role |
| --- | --- |
| `plugin/host/cleanup.js` | platform dispatcher (`PLATFORM`, `scanCleanup`, `deleteCleanup`, `cleanupItems`, `__test`) |
| `plugin/host/cleanup-darwin.js` | macOS allowlist + scan + delete |
| `plugin/host/cleanup-win32.js` | Windows allowlist + scan + delete (ASCII source; Recycle Bin through the PowerShell bridge) |
| `plugin/host/actions-darwin.js` / `actions-win32.js` | register the `cleanup.delete` action (group `system`, danger `high`) |

## `scanCleanup({ fresh } = {})`

Returns a JSON-safe document:

```js
{
  platform: 'darwin' | 'win32',
  generatedAt: 1762516500000,
  durationMs: 42,
  items: [{
    id, label, detail, path,
    category: 'cache' | 'logs' | 'trash' | 'temp' | 'developer' | 'updates',
    bytes, files, requiresAdmin, exists, error,   // error: string | null
  }],
  totalBytes, totalFiles,
  errors: [],                                     // string[]
}
```

Rules:

- recursive size walk uses `lstat` only; symbolic links are never followed and
  are not counted;
- each root is bounded to **150 000** directory entries and **5 000 ms**; a
  capped walk reports a truncation/timeout string in `item.error` and the scan
  continues;
- unreadable roots (permissions, TCC) yield `error` strings instead of throws;
  `requiresAdmin` items are scanned and shown, they are not hidden;
- results are cached for **60 s**; `fresh: true` bypasses the cache.

The dispatcher picks the implementation from `process.platform`; unknown hosts
fall back to the macOS implementation, whose roots then fail into `error`.

### macOS allowlist

| id | path | category | admin |
| --- | --- | --- | --- |
| `user-caches` | `~/Library/Caches` | cache | no |
| `user-logs` | `~/Library/Logs` | logs | no |
| `trash` | `~/.Trash` | trash | no |
| `xcode-derived-data` | `~/Library/Developer/Xcode/DerivedData` | developer | no |
| `crash-reports` | `~/Library/Application Support/CrashReporter` | logs | no |
| `core-simulator-caches` | `~/Library/Developer/CoreSimulator/Caches` | developer | no |
| `system-caches` | `/Library/Caches` | cache | yes |
| `system-logs` | `/Library/Logs` | logs | yes |

### Windows allowlist

| id | path | category | admin |
| --- | --- | --- | --- |
| `user-temp` | `%TEMP%` | temp | no |
| `localappdata-temp` | `%LOCALAPPDATA%\Temp` | temp | no |
| `crash-dumps` | `%LOCALAPPDATA%\CrashDumps` | logs | no |
| `thumbnail-cache` | `%LOCALAPPDATA%\Microsoft\Windows\Explorer` | cache | no |
| `recycle-bin` | Recycle Bin (special, all drives) | trash | no |
| `system-temp` | `%SystemRoot%\Temp` | temp | yes |
| `windows-update-downloads` | `%SystemRoot%\SoftwareDistribution\Download` | updates | yes |
| `delivery-optimization` | `%SystemRoot%\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization` | updates | yes |

Paths are computed from the environment once at module load. The Recycle Bin
is not a directory: its size is estimated through Shell.Application (0 bytes
plus a detail string when that is unavailable) and it is emptied with
`Clear-RecycleBin -Force` through the existing `runPSJson` bridge.

## `deleteCleanup(ids)`

```js
{
  ok: boolean,
  message: string,
  code?: 'BAD_PARAMS',
  data: {
    deletedBytes: number,
    items: [{ id, ok, bytes, message }],   // one entry per requested id
  },
}
```

- `ids` is an array (or comma separated string) of **1..20 unique** allowlist
  ids; unknown ids, paths, duplicates and oversized batches return
  `ok: false`, `code: 'BAD_PARAMS'` and delete nothing;
- cache/log/developer/temp roots are removed recursively and recreated empty
  so the owning application finds its directory;
- Trash (macOS) removes the directory's contents and keeps `~/.Trash`; the
  Windows Recycle Bin is emptied through `Clear-RecycleBin -Force`;
- admin-only roots are still attempted; the OS error is reported per item,
  never thrown;
- symbolic links are never followed; a link at the root is refused.

## `cleanupItems()`

The allowlist metadata: `[{ id, label, category, requiresAdmin, path }]`.
Used by the action validator, tests and client labelling.

## Action `cleanup.delete`

- group `system`, danger `high`, no `requiresAdmin` flag;
- exactly one parameter: `{ name: 'ids', type: 'string', required: true,
  multiple: true }` (the client sends an array; a comma separated string is
  accepted too);
- invalid parameters return `{ ok: false, code: 'BAD_PARAMS', message }` and
  are recorded in the action history like every other attempt;
- execution delegates to `deleteCleanup(ids)` and returns its envelope.

## Tests

`node scripts/verify-cleanup.mjs` (>= 35 checks) covers:

- syntax checks for every touched host module;
- a live macOS scan (shape, byte/file totals, categories, admin flags,
  JSON-safety, runtime bound) — read-only;
- allowlist immutability: unknown id / `../` path / duplicates / > 20 ids are
  refused and nothing is deleted; canary files stay in place;
- deletion against a temp sandbox only, through `__test.removeTreeAt` with an
  injected root; the public API never exposes a path parameter;
- cache behaviour (`fresh` vs cached) and catalogue/action-catalog checks;
- Windows fixture normalisation through `cleanup-win32.__test.normalizeWinItems`
  (`scripts/fixtures/win32/cleanup.json`);
- ASCII-only guard for `cleanup-win32.js` and `actions-win32.js`, and a static
  guard that no non-allowlisted path can reach `fs.rm`.

No test deletes real caches, logs or Trash on the development machine.
