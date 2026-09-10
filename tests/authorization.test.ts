import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApproveLeave, canCancelLeave, canManageEmployees, canAccessOwnEmployeeRecord, canAccessOrganization, isRoleAllowed } from '../src/lib/authorization';

test('employee cannot access HR-only employee management', () => {
  assert.equal(canManageEmployees('employee'), false);
  assert.equal(isRoleAllowed('employee', ['admin', 'hr']), false);
});

test('employee cannot approve or reject leave', () => {
  assert.equal(canApproveLeave('employee'), false);
});

test('employee can cancel only their own leave request', () => {
  assert.equal(canCancelLeave('employee', 'emp-1', 'emp-1', 'org-a', 'org-a'), true);
  assert.equal(canCancelLeave('employee', 'emp-1', 'emp-2', 'org-a', 'org-a'), false);
});

test('HR/admin can cancel another employee pending leave request', () => {
  assert.equal(canCancelLeave('hr', 'emp-1', 'emp-2', 'org-a', 'org-a'), true);
  assert.equal(canCancelLeave('admin', 'emp-1', 'emp-2', 'org-a', 'org-a'), true);
});

test('employee ownership check rejects another employee id', () => {
  assert.equal(canAccessOwnEmployeeRecord('emp-1', 'emp-2', 'org-a', 'org-a'), false);
  assert.equal(canAccessOwnEmployeeRecord('emp-1', 'emp-1', 'org-a', 'org-a'), true);
  assert.equal(canAccessOwnEmployeeRecord(null, 'emp-1', 'org-a', 'org-a'), false);
});

test('organization boundary rejects cross-tenant access', () => {
  assert.equal(canAccessOrganization('org-a', 'org-a'), true);
  assert.equal(canAccessOrganization('org-a', 'org-b'), false);
  assert.equal(canCancelLeave('hr', 'emp-1', 'emp-2', 'org-a', 'org-b'), false);
  assert.equal(canAccessOwnEmployeeRecord('emp-1', 'emp-1', 'org-a', 'org-b'), false);
});
