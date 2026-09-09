import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countInclusiveDays, validateDateRange, parseDateOnly } from '../src/lib/leave-rules';

test('single-day leave counts as 1 day', () => {
  assert.equal(countInclusiveDays('2026-09-10', '2026-09-10'), 1);
});

test('five consecutive days counts as 5', () => {
  assert.equal(countInclusiveDays('2026-09-08', '2026-09-12'), 5);
});

test('counts correctly across a month boundary', () => {
  assert.equal(countInclusiveDays('2026-01-30', '2026-02-02'), 4);
});

test('rejects an end date before the start date', () => {
  assert.equal(validateDateRange('2026-09-12', '2026-09-08'), 'End date cannot be before the start date.');
});

test('accepts a valid ascending range', () => {
  assert.equal(validateDateRange('2026-09-08', '2026-09-12'), null);
});

test('accepts a same-day range', () => {
  assert.equal(validateDateRange('2026-09-08', '2026-09-08'), null);
});

test('rejects an unparsable date string', () => {
  assert.equal(validateDateRange('not-a-date', '2026-09-12'), 'Start and end dates must be valid calendar dates.');
});

test('parseDateOnly returns null for invalid input', () => {
  assert.equal(parseDateOnly('garbage'), null);
});
