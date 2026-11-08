#!/usr/bin/env node
/**
 * Device X — build the publishable tarball.
 *
 * `npm pack` is run inside `plugin/` because that manifest (not the
 * Git-installable root one) defines what ships. The tarball is then audited
 * before CI hands it to npm and to a GitHub Release:
 *
 *  - it is named after the manifest version and carries the committed
 *    `client.js` byte-for-byte (the artifact verified by `verify:ci`);
 *  - every runtime file the Host needs is inside (Host modules, Windows
 *    PowerShell scripts, locales, icon, patch);
 *  - no sources, tests, scripts, dev config or `node_modules` leak in;
 *  - the packaged manifest is publishable (`private` gone, public access).
 *
 * Usage:
 *   node scripts/pack-release.mjs             # writes dist/<name>-<version>.tgz
 *   node scripts/pack-release.mjs --out <dir> # write elsewhere (CI artifacts)
 *   node scripts/pack-release.mjs --github-output  # expose tarball/tarball_path steps
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const pluginDir = join(root, 'plugin');

const argv = process.argv.slice(2);
const wantGithubOutput = argv.includes('--github-output');
const outIndex = argv.indexOf('--out');
const rawOut = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : join(root, 'dist');
// `--out` is relative to the invoking shell, while `npm pack` runs with cwd
// set to plugin/ — resolve once so both refer to the same directory.
const outDir = resolve(process.cwd(), rawOut);
mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const { name, version } = manifest;

// Scoped names lose their scope separator in tarball names: @a/b → a-b-<version>.
const tarballName = `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
const tarballPath = join(outDir, tarballName);

const failures = [];
const passed = [];
function check(label, condition, detail) {
  if (condition) {
    passed.push(label);
    console.log(`  PASS ${label}${detail === undefined ? '' : ` (${detail})`}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

console.log(`\n=== npm pack (${name}@${version}) ===`);
if (existsSync(tarballPath)) rmSync(tarballPath);
execFileSync('npm', ['pack', '--pack-destination', outDir], { cwd: pluginDir, stdio: ['ignore', 'ignore', 'inherit'] });
if (!existsSync(tarballPath)) {
  console.error(`FAIL npm pack did not produce ${tarballPath}`);
  process.exit(1);
}

// --- entries ----------------------------------------------------------------

const entries = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const tar = (entry) => execFileSync('tar', ['-xzOf', tarballPath, entry], { encoding: 'buffer' });

console.log(`\n=== tarball contents (${entries.length} entries) ===`);

const required = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/index.js',
  'package/client.js',
  'package/cordis.patch.yml',
  'package/icon.svg',
  'package/locale/en.json',
  'package/locale/zh.json',
];
for (const entry of required) check(`ships ${entry}`, entries.includes(entry));

for (const pattern of [/^package\/host\/[^/]+\.js$/, /^package\/host\/win\/[^/]+\.ps1$/]) {
  const matches = entries.filter((entry) => pattern.test(entry));
  check(`ships ${pattern.source}`, matches.length > 0, matches.length);
}

// The tarball must not carry development files: everything it contains is served
// to the Host or read by the Windows bridge at runtime.
const forbidden = [
  'package/src/',
  'package/test/',
  'package/scripts/',
  'package/node_modules/',
  'package/tsconfig',
  'package/package-lock.json',
  'package/.github/',
];
for (const prefix of forbidden) {
  const leaked = entries.filter((entry) => entry === prefix || entry.startsWith(prefix));
  check(`excludes ${prefix}`, leaked.length === 0, leaked.slice(0, 3).join(', ') || '0');
}

// --- packaged manifest ------------------------------------------------------

const packagedManifest = JSON.parse(tar('package/package.json').toString('utf8'));
check('packaged manifest is the publishable one', packagedManifest.private !== true);
check('packaged manifest keeps the published name', packagedManifest.name === name, packagedManifest.name);
check('packaged manifest keeps the version', packagedManifest.version === version, packagedManifest.version);
check(
  'packaged manifest declares public access',
  packagedManifest.publishConfig?.access === 'public',
);
check('packaged manifest declares its license', Boolean(packagedManifest.license), packagedManifest.license);

// `plugin/LICENSE` is a copy of the root LICENSE (npm only ships files inside
// the package directory), so guard against the two silently drifting apart.
const committedLicense = readFileSync(join(root, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n');
const packagedLicense = tar('package/LICENSE').toString('utf8').replace(/\r\n/g, '\n');
check('packaged LICENSE matches the repository LICENSE', committedLicense === packagedLicense);

// --- committed artifact -----------------------------------------------------

const committedClient = readFileSync(join(pluginDir, 'client.js'));
const packagedClient = tar('package/client.js');
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
check(
  'packaged client.js is the committed build artifact',
  digest(committedClient) === digest(packagedClient),
  `${digest(packagedClient).slice(0, 12)}…`,
);
check(
  'packaged client.js carries the generated banner',
  packagedClient.toString('utf8').startsWith('/* Device X client — generated from'),
);

// --- summary ----------------------------------------------------------------

const sizeKb = (statSync(tarballPath).size / 1024).toFixed(1);
console.log(`\n=== result ===`);
console.log(`  tarball  ${tarballPath}`);
console.log(`  size     ${sizeKb} KB, ${entries.length} entries`);
console.log(`  checks   ${passed.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

if (wantGithubOutput) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) {
    console.error('FAIL --github-output needs $GITHUB_OUTPUT (run inside GitHub Actions)');
    process.exit(1);
  }
  appendFileSync(
    output,
    [`tarball=${tarballName}`, `tarball_path=${tarballPath}`, `checks=${passed.length}`, ''].join('\n'),
  );
}
console.log(`packed ${tarballName}`);
