/**
 * `moveToTrash` regression tests.
 *
 * These drive the mover against a temporary sandbox through the `trashDir`
 * seam, never against the real `~/.Trash`. They exist because the shipped
 * implementation had two defects that could destroy user data:
 *
 *  1. it probed with `access()` and then renamed, which is a race — `rename`
 *     silently overwrites an existing destination;
 *  2. it hard-coded a `.app` suffix, so a data directory was trashed as
 *     `com.example-1712345678901.app`.
 */
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { __trashTest } from '../plugin/host/actions-darwin.js';

const { moveToTrash, reserveTrashName } = __trashTest;

/** A throwaway sandbox with its own source area and Trash. */
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'dx-trash-test-'));
  const source = join(root, 'source');
  const trash = join(root, 'Trash');
  await mkdir(source, { recursive: true });
  await mkdir(trash, { recursive: true });
  return { root, source, trash };
}

test('moveToTrash keeps a data directory name free of the .app suffix', async () => {
  const { source, trash, root } = await sandbox();
  try {
    // A real leftover directory name, as found in ~/Library/Caches.
    const victim = join(source, 'com.colliderli.iina');
    await mkdir(victim);
    await writeFile(join(victim, 'data.bin'), 'payload');
    const destination = await moveToTrash(victim, { trashDir: trash });
    // The whole point: no `.app` was invented for a directory that had none.
    assert.ok(!destination.endsWith('.app'), destination);
    assert.ok(destination.startsWith(trash));
    assert.equal(await readFile(join(destination, 'data.bin'), 'utf8'), 'payload');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moveToTrash tolerates a directory whose name merely ends in .app', async () => {
  const { source, trash, root } = await sandbox();
  try {
    // Defensive: a *data* directory that happens to end in `.app` must still be
    // moved, not rejected, and must keep something usable as its name.
    const victim = join(source, 'com.example.app');
    await mkdir(victim);
    await writeFile(join(victim, 'data.bin'), 'payload');
    const destination = await moveToTrash(victim, { trashDir: trash });
    assert.equal(await readFile(join(destination, 'data.bin'), 'utf8'), 'payload');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moveToTrash keeps the .app suffix for a real bundle', async () => {
  const { source, trash, root } = await sandbox();
  try {
    const bundle = join(source, 'SomeApp.app');
    await mkdir(join(bundle, 'Contents'), { recursive: true });
    await writeFile(join(bundle, 'Contents', 'Info.plist'), 'plist');
    const destination = await moveToTrash(bundle, { trashDir: trash });
    assert.ok(destination.endsWith('.app'), destination);
    assert.equal(await readFile(join(destination, 'Contents', 'Info.plist'), 'utf8'), 'plist');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moveToTrash never overwrites an existing file in the Trash', async () => {
  const { source, trash, root } = await sandbox();
  try {
    // A file already sitting in the Trash that must survive.
    const existing = join(trash, 'collision.txt');
    await writeFile(existing, 'FIRST');

    const victim = join(source, 'collision.txt');
    await writeFile(victim, 'SECOND');

    const destination = await moveToTrash(victim, { trashDir: trash });
    assert.notEqual(destination, existing);
    // The pre-existing file is untouched: this is the race the old code lost.
    assert.equal(await readFile(existing, 'utf8'), 'FIRST');
    assert.equal(await readFile(destination, 'utf8'), 'SECOND');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moveToTrash never overwrites an existing directory in the Trash', async () => {
  const { source, trash, root } = await sandbox();
  try {
    const existing = join(trash, 'collision');
    await mkdir(existing);
    await writeFile(join(existing, 'keep.txt'), 'FIRST');

    const victim = join(source, 'collision');
    await mkdir(victim);
    await writeFile(join(victim, 'new.txt'), 'SECOND');

    const destination = await moveToTrash(victim, { trashDir: trash });
    assert.notEqual(destination, existing);
    assert.deepEqual((await readdir(existing)).sort(), ['keep.txt']);
    assert.deepEqual((await readdir(destination)).sort(), ['new.txt']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reserveTrashName returns distinct names for repeated reservations', async () => {
  const { trash, root } = await sandbox();
  try {
    const first = await reserveTrashName(trash, 'thing', '', true);
    const second = await reserveTrashName(trash, 'thing', '', true);
    assert.notEqual(first, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reserveTrashName reserves a file with a zero-length placeholder', async () => {
  const { trash, root } = await sandbox();
  try {
    const reserved = await reserveTrashName(trash, 'note', '.txt', false);
    assert.ok(reserved.endsWith('.txt'));
    assert.equal(await readFile(reserved, 'utf8'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moveToTrash reports a missing source instead of creating an empty Trash entry', async () => {
  const { source, trash, root } = await sandbox();
  try {
    await assert.rejects(() => moveToTrash(join(source, 'absent.txt'), { trashDir: trash }));
    // Nothing was left behind by the failed attempt.
    assert.deepEqual(await readdir(trash), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
