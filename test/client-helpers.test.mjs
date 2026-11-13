/**
 * Pure client formatters.
 *
 * `src/client/helpers.js` is the one module the client and its tests share
 * without a DOM, and `fmtUptime` is used by four components (uptime KPI, system
 * tab, battery remaining, process elapsed) so a wrong unit here is visible in
 * several places at once. These tests pin the unit boundaries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fmtBytes, fmtUptime, fmtMs, fmtPercent, percentOf } = await import('../src/client/helpers.js');

/** English dictionary subset the formatters read through `t`. */
const EN = {
  'unit.day': 'd',
  'unit.hour': 'h',
  'unit.minute': 'min',
  'unit.lessThanMinute': 'less than a minute',
};
const t = (key) => (Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key);

/* ----------------------------------------------------------------- uptime */

test('fmtUptime reports sub-minute durations instead of "0 min"', () => {
  // The branch used to require `day === 0 && parts.length === 0`, but the hour
  // branch pushes before it, so anything under a minute fell through to pushing
  // "0 min" and the `unit.lessThanMinute` string was unreachable.
  assert.equal(fmtUptime(0, t), 'less than a minute');
  assert.equal(fmtUptime(12, t), 'less than a minute');
  assert.equal(fmtUptime(59, t), 'less than a minute');
});

test('fmtUptime switches to minutes at exactly one minute', () => {
  assert.equal(fmtUptime(60, t), '1 min');
  assert.equal(fmtUptime(119, t), '1 min');
  assert.equal(fmtUptime(3599, t), '59 min');
});

test('fmtUptime stops at hours: minutes are only shown below an hour', () => {
  assert.equal(fmtUptime(3600, t), '1 h');
  assert.equal(fmtUptime(3660, t), '1 h');
  assert.equal(fmtUptime(86399, t), '23 h');
});

test('fmtUptime shows at most two units', () => {
  assert.equal(fmtUptime(86400, t), '1 d');
  assert.equal(fmtUptime(90061, t), '1 d 1 h');
  // 3 d 4 h 12 min -> the minutes are dropped rather than making the cell wide.
  assert.equal(fmtUptime(3 * 86400 + 4 * 3600 + 12 * 60, t), '3 d 4 h');
});

test('fmtUptime returns an em dash for missing or negative input', () => {
  for (const value of [null, undefined, Number.NaN, -1, -0.5, '12', '', {}]) {
    assert.equal(fmtUptime(value, t), '—', `expected em dash for ${String(value)}`);
  }
});

/* ------------------------------------------------------------------ bytes */

test('fmtBytes keeps bytes below 1024 unitless-scale', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(1), '1 B');
  assert.equal(fmtBytes(1023), '1023 B');
});

test('fmtBytes scales at 1024 and drops decimals at three digits', () => {
  assert.equal(fmtBytes(1024), '1.0 KB');
  assert.equal(fmtBytes(1536), '1.5 KB');
  assert.equal(fmtBytes(1024 * 99), '99.0 KB');
  // >= 100 keeps no decimals, so the cell never grows past "999".
  assert.equal(fmtBytes(1024 * 100), '100 KB');
  assert.equal(fmtBytes(1024 * 1024 * 1.5), '1.5 MB');
});

test('fmtBytes refuses to format negative or non-finite values', () => {
  for (const value of [null, undefined, Number.NaN, Infinity, -1, '1024']) {
    assert.equal(fmtBytes(value), '—', `expected em dash for ${String(value)}`);
  }
});

/* -------------------------------------------------------------- durations */

test('fmtMs switches from milliseconds to seconds at 1000', () => {
  assert.equal(fmtMs(0), '0 ms');
  assert.equal(fmtMs(999), '999 ms');
  assert.equal(fmtMs(1000), '1.0 s');
  assert.equal(fmtMs(1500), '1.5 s');
  assert.equal(fmtMs(10_000), '10 s');
  assert.equal(fmtMs(Number.NaN), '—');
});

/* ------------------------------------------------------------- percentages */

test('fmtPercent and percentOf agree and guard against a zero total', () => {
  assert.equal(fmtPercent(12.34, 1), '12.3%');
  assert.equal(percentOf(50, 200), 25);
  assert.equal(percentOf(1, 0), null);
  assert.equal(percentOf(null, 200), null);
  assert.equal(fmtPercent(null, 1), '—');
});
