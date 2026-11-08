#!/usr/bin/env node
/**
 * Device X — release metadata guard.
 *
 * One version has to be spelled identically in four places before anything is
 * published: the git tag (`v<version>`), the root manifest, the published
 * manifest (`plugin/package.json`) and the newest entry of `CHANGELOG.md`.
 * Keeping that decision in one script means the release workflow and a local
 * pre-flight run can never disagree about which version is being shipped.
 *
 * Usage:
 *   node scripts/check-release-version.mjs                  # version from plugin/package.json
 *   node scripts/check-release-version.mjs --tag v1.5.0     # tag-driven (CI pushes tags)
 *   node scripts/check-release-version.mjs --version 1.5.0  # explicit
 *   node scripts/check-release-version.mjs --github-output  # append GitHub step outputs
 *   node scripts/check-release-version.mjs --notes          # print the CHANGELOG section
 *
 * Resolution order: --version, then RELEASE_VERSION (workflow_dispatch input),
 * then --tag / GITHUB_REF_NAME, then the manifest version.
 *
 * Exit code 0 means "safe to publish this version"; 1 lists every problem found.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const flagValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const wantNotes = hasFlag('--notes');
const wantGithubOutput = hasFlag('--github-output');

/** SemVer 2.0.0 without the exhaustive class-per-component gymnastics. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const problems = [];
const warnings = [];
function fail(message) {
  problems.push(message);
}
function warn(message) {
  warnings.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

const rootManifest = readJson('package.json');
const pluginManifest = readJson(join('plugin', 'package.json'));

// --- which version is this? -------------------------------------------------

const explicitVersion = flagValue('--version') ?? process.env.RELEASE_VERSION ?? '';
const tag = flagValue('--tag') ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '');

const versionFrom = explicitVersion || (tag ? tag.replace(/^v/, '') : '') || pluginManifest.version;

const release = {
  name: pluginManifest.name,
  version: versionFrom,
  tag: tag || `v${versionFrom}`,
  // SemVer pre-release is `-…` before build metadata (`+…`); a dash inside the
  // build metadata (1.5.0+build-1) is not a pre-release.
  prerelease: String(versionFrom).split('+')[0].includes('-'),
};

// --- checks -----------------------------------------------------------------

if (!SEMVER.test(release.version)) {
  fail(`version "${release.version}" is not valid SemVer`);
}
if (tag && tag !== `v${release.version}`) {
  fail(`tag "${tag}" does not match version "${release.version}" (expected "v${release.version}")`);
}
for (const [label, manifest] of [
  ['root package.json', rootManifest],
  ['plugin/package.json', pluginManifest],
]) {
  if (manifest.version !== release.version) {
    fail(`${label} version is "${manifest.version}", expected "${release.version}"`);
  }
}
if (rootManifest.name !== pluginManifest.name) {
  fail(`root name is "${rootManifest.name}", expected "${pluginManifest.name}"`);
}

// npm matches `repository.url` against the OIDC repository claim when signing
// provenance, and an ssh/scp form or a stale owner is the most common cause of
// "provenance could not be generated". Compare normalized URLs instead.
const normalizeRepo = (url) =>
  String(url ?? '')
    .replace(/^git\+/, '')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
const rootRepo = normalizeRepo(rootManifest.repository?.url);
const pluginRepo = normalizeRepo(pluginManifest.repository?.url);
if (!rootRepo) {
  fail('root package.json has no repository.url (npm provenance needs it)');
} else if (rootRepo !== pluginRepo) {
  fail(`repository.url differs between manifests ("${rootRepo}" vs "${pluginRepo}")`);
} else if (process.env.GITHUB_REPOSITORY && rootRepo !== `https://github.com/${process.env.GITHUB_REPOSITORY}`.toLowerCase()) {
  fail(`repository.url is "${rootRepo}" but this run is ${process.env.GITHUB_REPOSITORY}`);
}

// The root manifest is Git-installable and must stay unpublishable; the plugin
// manifest is the one npm receives, so it must not be private.
if (rootManifest.private !== true) {
  fail('root package.json must stay "private": true (only plugin/ is published)');
}
if (pluginManifest.private === true) {
  fail('plugin/package.json is "private": true — npm refuses to publish it');
}
if (pluginManifest.publishConfig?.access !== 'public') {
  fail('plugin/package.json needs "publishConfig": { "access": "public" } for a scoped package');
}
// --- license ----------------------------------------------------------------
// The licence must be declared identically in both manifests and shipped inside
// the package directory: npm only includes files under `plugin/`, so a root
// LICENSE alone never reaches the tarball.
const rootLicense = String(rootManifest.license ?? '').trim();
const pluginLicense = String(pluginManifest.license ?? '').trim();
const rootLicenseFile = join(root, 'LICENSE');
const pluginLicenseFile = join(root, 'plugin', 'LICENSE');

if (!pluginLicense) {
  fail('plugin/package.json has no "license" field; npm would publish it as unlicensed');
} else if (!rootLicense) {
  fail('root package.json has no "license" field');
} else if (rootLicense !== pluginLicense) {
  fail(`license differs between manifests ("${rootLicense}" vs "${pluginLicense}")`);
}
if (!existsSync(pluginLicenseFile)) {
  fail('plugin/LICENSE is missing; npm only ships files from the package directory');
}
if (!existsSync(rootLicenseFile)) {
  fail('LICENSE is missing at the repository root');
}
if (existsSync(rootLicenseFile) && existsSync(pluginLicenseFile)) {
  const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const rootText = read(rootLicenseFile);
  if (rootText !== read(pluginLicenseFile)) {
    fail('plugin/LICENSE differs from the root LICENSE');
  } else if (pluginLicense === 'MIT' && !/MIT License/i.test(rootText)) {
    warn('LICENSE is declared MIT but the file does not look like the MIT text');
  }
}

// --- CHANGELOG --------------------------------------------------------------

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
const heading = new RegExp(`^##\\s+${release.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
const start = lines.findIndex((line) => heading.test(line));
let body = '';
if (start === -1) {
  fail(`CHANGELOG.md has no "## ${release.version}" section`);
} else {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  body = lines.slice(start + 1, end).join('\n').trim();
  if (body.length === 0) {
    fail(`CHANGELOG.md section "## ${release.version}" is empty`);
  }
}

// --- output -----------------------------------------------------------------

if (wantNotes) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exit(1);
  }
  process.stdout.write(`${body}\n`);
  process.exit(0);
}

const lines_out = [];
lines_out.push(`release ${release.name}@${release.version}`);
lines_out.push(`  tag        ${release.tag}`);
lines_out.push(`  npm tag    ${release.prerelease ? 'next (prerelease)' : 'latest'}`);
lines_out.push(`  changelog  ${problems.some((p) => p.startsWith('CHANGELOG')) ? 'missing' : 'ok'}`);
for (const warning of warnings) lines_out.push(`WARN ${warning}`);
for (const problem of problems) lines_out.push(`FAIL ${problem}`);
console.log(lines_out.join('\n'));

if (problems.length > 0) {
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
    [
      `name=${release.name}`,
      `version=${release.version}`,
      `tag=${release.tag}`,
      `prerelease=${release.prerelease}`,
      `npm_tag=${release.prerelease ? 'next' : 'latest'}`,
      '',
    ].join('\n'),
  );
}
