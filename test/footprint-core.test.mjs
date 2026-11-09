/**
 * Uninstall-footprint kernel tests.
 *
 * Every case below is a trap that was hit while measuring a real macOS host,
 * not a hypothetical: Team-ID-prefixed group containers, the `Doubao` vs
 * `DoubaoWork` name collision, `Code` swallowing `Codex`, and the 11 GB
 * `Claude-3p` directory that no bundle-id rule can find.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildIndex,
  compactSlug,
  dedupeApps,
  classify,
  isVendorShared,
  matchesAppName,
  matchesBundleId,
  ownersOf,
  selectedBytes,
  slugify,
  stripTeamPrefix,
  totalBytes,
  toAppContext,
} from '../plugin/host/footprint-core.js';

/* ------------------------------------------------------------- prefixes */

test('stripTeamPrefix removes the 10-char Team ID', () => {
  assert.equal(stripTeamPrefix('6N38VWS5BX.ru.keepcoder.Telegram'), 'ru.keepcoder.Telegram');
  assert.equal(stripTeamPrefix('2DC432GLL2.com.openai.sky.CUAService'), 'com.openai.sky.CUAService');
});

test('stripTeamPrefix removes the group. marker as well', () => {
  assert.equal(stripTeamPrefix('group.W5364U7YZB.io.tailscale.shared'), 'io.tailscale.shared');
  assert.equal(stripTeamPrefix('group.com.apple.podcasts'), 'com.apple.podcasts');
});

test('stripTeamPrefix leaves ordinary names alone', () => {
  assert.equal(stripTeamPrefix('com.colliderli.iina'), 'com.colliderli.iina');
  assert.equal(stripTeamPrefix('Application Support'), 'Application Support');
  assert.equal(stripTeamPrefix(''), '');
  assert.equal(stripTeamPrefix(undefined), '');
});

/* --------------------------------------------------------------- slugify */

test('slugify folds spaces, dashes and case but keeps the boundary', () => {
  // Separators collapse to a single `-` rather than vanishing: `claude-3p` must
  // stay distinguishable from a hypothetical `claude3p` directory.
  assert.equal(slugify('Clash Verge'), 'clash-verge');
  assert.equal(slugify('clash-verge'), 'clash-verge');
  assert.equal(slugify('Visual Studio Code.app'), 'visual-studio-code');
  assert.equal(slugify('Z-Library'), 'z-library');
  assert.equal(slugify('Claude-3p'), 'claude-3p');
  assert.equal(slugify('  spaced  '), 'spaced');
  assert.equal(slugify(undefined), '');
});

test('compactSlug removes every separator', () => {
  assert.equal(compactSlug('Acme Widget'), 'acmewidget');
  assert.equal(compactSlug('Acme.Widget_8wekyb3d8bbwe'), 'acmewidget8wekyb3d8bbwe');
  assert.equal(compactSlug('Claude-3p'), 'claude3p');
});

/* ---------------------------------------------------- bundle-id matching */

test('matchesBundleId requires a dot boundary, not a bare prefix', () => {
  assert.equal(matchesBundleId('com.colliderli.iina', 'com.colliderli.iina'), true);
  assert.equal(matchesBundleId('com.colliderli.iina.shipit', 'com.colliderli.iina'), true);
  // The trap: `com.foo` must not claim `com.foobar`.
  assert.equal(matchesBundleId('com.foobar', 'com.foo'), false);
  assert.equal(matchesBundleId('com.foobar.baz', 'com.foo'), false);
  assert.equal(matchesBundleId('', 'com.foo'), false);
  assert.equal(matchesBundleId('com.foo', ''), false);
});

/* ------------------------------------------------- name matching anchors */

test('matchesAppName never matches a bare substring', () => {
  // Observed on a real host: `Code` was hitting Codex and CodeBuddyExtension.
  assert.equal(matchesAppName('code', 'code'), true);
  assert.equal(matchesAppName('codex', 'code'), false);
  assert.equal(matchesAppName('codebuddyextension', 'code'), false);
  assert.equal(matchesAppName('code-3p', 'code'), true);
  assert.equal(matchesAppName('code.helper', 'code'), true);
  assert.equal(matchesAppName('code_old', 'code'), true);
});

test('matchesAppName keeps the Claude-3p case working', () => {
  // `~/Library/Application Support/Claude-3p` is 11 GB on the measured host and
  // matches no bundle id; this single rule is the only thing that finds it.
  assert.equal(matchesAppName('claude-3p', 'claude'), true);
  assert.equal(matchesAppName('claude', 'claude'), true);
});

/* -------------------------------------------------------- vendor shares */

test('isVendorShared flags vendor-level directories', () => {
  assert.equal(isVendorShared('Google'), true);
  assert.equal(isVendorShared('Microsoft'), true);
  assert.equal(isVendorShared('com.google'), true);
  // A concrete product directory inside a vendor folder is not itself shared.
  assert.equal(isVendorShared('com.google.Chrome'), false);
  assert.equal(isVendorShared('Code'), false);
  assert.equal(isVendorShared('Claude'), false);
});

/* ---------------------------------------------------------- owner lookup */

const INSTALLED = [
  toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' }),
  toAppContext({ name: 'Telegram', bundleId: 'ru.keepcoder.Telegram' }),
  toAppContext({ name: 'Clash Verge', bundleId: 'io.github.clash-verge-rev.clash-verge-rev' }),
  toAppContext({ name: 'Doubao', bundleId: 'com.bytedance.doubao' }),
  toAppContext({ name: 'DoubaoWork', bundleId: 'com.work.pc.doubao' }),
  toAppContext({ name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode' }),
];

const find = (name) => INSTALLED.find((app) => app.name === name);

test('ownersOf resolves a Team-ID-prefixed group container', () => {
  const owners = ownersOf('6N38VWS5BX.ru.keepcoder.Telegram', [find('Telegram')]);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].name, 'Telegram');
});

test('ownersOf resolves bundle-id children', () => {
  const owners = ownersOf('com.anthropic.claudefordesktop.ShipIt', [find('Claude')]);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].name, 'Claude');
});

test('ownersOf reports every name collision', () => {
  // `doubaowork` is a prefix-match for the slug `doubao` only if matching were
  // sloppy; anchored matching means `doubao` alone owns neither of the others.
  const bare = ownersOf('doubaowork', INSTALLED);
  assert.deepEqual(bare.map((app) => app.name), ['DoubaoWork']);
  const doubao = ownersOf('doubao', INSTALLED);
  assert.deepEqual(doubao.map((app) => app.name), ['Doubao']);
});

/* ------------------------------------------------------------ classify */

test('classify: bundle-id hit is high confidence', () => {
  const result = classify(
    { name: 'com.colliderli.iina' },
    toAppContext({ name: 'IINA', bundleId: 'com.colliderli.iina' }),
    [toAppContext({ name: 'IINA', bundleId: 'com.colliderli.iina' })],
  );
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'bundle-id');
});

test('classify: brew zap hit is high confidence even without a name match', () => {
  const result = classify(
    { name: 'SomeOldFolder' },
    toAppContext({ name: 'IINA', bundleId: 'com.colliderli.iina' }),
    [],
    { fromBrewZap: true },
  );
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'brew-zap');
});

test('classify: name-only match is tier B (medium), with a readable reason', () => {
  const subject = toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' });
  const result = classify({ name: 'Claude-3p' }, subject, [subject]);
  // Design §4: tier B defaults to UNSELECTED; the UI shows the reason so the
  // user can accept it. This is the only rule that finds the 11 GB directory.
  assert.equal(result.confidence, 'medium');
  assert.equal(result.source, 'name-match');
  assert.match(result.reason, /Claude/);
});

test('classify: tier B is excluded from the default selected total', () => {
  const subject = toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' });
  const result = classify({ name: 'Claude-3p' }, subject, [subject]);
  assert.equal(selectedBytes([{ bytes: 11_000_000_000, confidence: result.confidence }]), 0);
  assert.equal(totalBytes([{ bytes: 11_000_000_000, confidence: result.confidence }]), 11_000_000_000);
});

test('classify: two owners upgrade the tier to conflict', () => {
  // A user-named directory can legitimately match two installed apps by name.
  // Construct exactly that: two distinct products whose slugs collide.
  const twoApps = [
    toAppContext({ name: 'Foo', bundleId: 'com.example.foo' }),
    toAppContext({ name: 'foo', bundleId: 'com.example.other' }),
  ];
  const conflicted = classify({ name: 'foo' }, twoApps[0], twoApps);
  assert.equal(conflicted.confidence, 'conflict');
  assert.deepEqual(conflicted.alsoMatchedBy, ['foo']);
});

test('classify: distinct bundle ids are never collapsed by a shared slug', () => {
  // Regression guard: comparing slugs alone silently turned `conflict` into
  // `high`, which would have preselected a directory another app also owns.
  const twoApps = [
    toAppContext({ name: 'Foo', bundleId: 'com.a.foo' }),
    toAppContext({ name: 'Foo', bundleId: 'com.b.foo' }),
  ];
  const result = classify({ name: 'foo' }, twoApps[0], twoApps);
  assert.equal(result.confidence, 'conflict');
  assert.equal(result.alsoMatchedBy.length, 1);
});

test('classify: vendor directory is shared only when it holds the subject', () => {
  const subject = toAppContext({ name: 'Google Chrome', bundleId: 'com.google.Chrome' });
  // An unrelated vendor directory is noise and must disappear entirely.
  assert.equal(classify({ name: 'Google' }, subject, [subject]), null);
  // The subject's own vendor directory is reference-only, never deletable.
  const kept = classify({ name: 'Google' }, subject, [subject], { holdsSubject: true });
  assert.equal(kept.confidence, 'shared');
});

test('classify: unrelated directory returns null', () => {
  const subject = toAppContext({ name: 'IINA', bundleId: 'com.colliderli.iina' });
  assert.equal(classify({ name: 'SomeOtherApp' }, subject, [subject]), null);
});

/* --------------------------------------------------------------- totals */

test('totalBytes and selectedBytes ignore junk values', () => {
  const items = [
    { bytes: 100, confidence: 'high' },
    { bytes: 50, confidence: 'medium' },
    { bytes: -5, confidence: 'high' },
    { bytes: 'nope', confidence: 'high' },
    { bytes: undefined, confidence: 'conflict' },
  ];
  assert.equal(totalBytes(items), 150);
  assert.equal(selectedBytes(items), 100);
  assert.equal(totalBytes(null), 0);
  assert.equal(selectedBytes(undefined), 0);
});

/* --------------------------------------------------------------- dedupe */

test('dedupeApps collapses the collector triple-reporting a bundle', () => {
  // Observed on a real host: `com.anthropic.claude-code` appeared three times,
  // which made a single installed app look like three competing owners and
  // wrongly downgraded every name match to `conflict`.
  const apps = [
    toAppContext({ name: 'claude', bundleId: 'com.anthropic.claude-code' }),
    toAppContext({ name: 'claude', bundleId: 'com.anthropic.claude-code' }),
    toAppContext({ name: 'claude', bundleId: 'com.anthropic.claude-code' }),
    toAppContext({ name: 'Claude', bundleId: 'com.anthropic.claudefordesktop' }),
  ];
  const deduped = dedupeApps(apps);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((app) => app.bundleId), [
    'com.anthropic.claude-code',
    'com.anthropic.claudefordesktop',
  ]);
});

test('dedupeApps keeps apps that share a slug but not a bundle id', () => {
  const deduped = dedupeApps([
    toAppContext({ name: 'Foo', bundleId: 'com.a.foo' }),
    toAppContext({ name: 'foo', bundleId: 'com.b.foo' }),
  ]);
  assert.equal(deduped.length, 2);
});

test('dedupeApps falls back to the slug when there is no bundle id', () => {
  const deduped = dedupeApps([
    toAppContext({ name: 'Thing' }),
    toAppContext({ name: 'thing' }),
    toAppContext({ name: 'Other' }),
  ]);
  assert.equal(deduped.length, 2);
});

/* ---------------------------------------------------------------- index */

test('buildIndex indexes lowercase names and skips malformed entries', () => {
  const index = buildIndex([
    { name: 'Claude', relPath: '~/Library/Application Support/Claude' },
    { name: 'claude', relPath: '~/Library/Caches/claude' },
    { name: 'Bad' },
    null,
  ]);
  assert.equal(index.entries.length, 2);
  assert.deepEqual(index.byLowerName.get('claude'), [0, 1]);
  assert.equal(index.byLowerName.get('bad'), undefined);
});

test('buildIndex tolerates a non-array input', () => {
  assert.deepEqual(buildIndex(undefined).entries, []);
  assert.deepEqual(buildIndex('nope').entries, []);
});
