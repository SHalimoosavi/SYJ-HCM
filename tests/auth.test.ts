import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHrOrAdmin } from '../src/lib/auth';

test('admin role is treated as HR/admin', () => {
  assert.equal(isHrOrAdmin('admin'), true);
});

test('hr role is treated as HR/admin', () => {
  assert.equal(isHrOrAdmin('hr'), true);
});

test('employee role is not treated as HR/admin', () => {
  assert.equal(isHrOrAdmin('employee'), false);
});
