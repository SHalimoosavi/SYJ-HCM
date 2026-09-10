import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLoginRateLimit, clearLoginFailures, getLoginRateLimitKey, recordFailedLogin } from '../src/lib/login-rate-limit';

const organizationId = 'org_default';
const key = getLoginRateLimitKey('employee@test.local', '127.0.0.1', organizationId);

// Keep the shared temporary DB deterministic between tests.
test('login rate limiter allows normal attempts and locks after five failures', () => {
  clearLoginFailures(key, organizationId);
  const now = new Date('2026-09-09T10:00:00.000Z');

  assert.equal(checkLoginRateLimit(key, organizationId, now).allowed, true);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(recordFailedLogin(key, organizationId, new Date(now.getTime() + i * 1000)).allowed, true);
  }

  const fifth = recordFailedLogin(key, organizationId, new Date(now.getTime() + 4000));
  assert.equal(fifth.allowed, false);
  assert.equal(checkLoginRateLimit(key, organizationId, new Date(now.getTime() + 5000)).allowed, false);
});

test('login rate limiter resets after the rolling window', () => {
  clearLoginFailures(key, organizationId);
  const now = new Date('2026-09-09T10:00:00.000Z');
  recordFailedLogin(key, organizationId, now);
  assert.equal(checkLoginRateLimit(key, organizationId, new Date(now.getTime() + 16 * 60 * 1000)).allowed, true);
});

test('successful login clears the failure state', () => {
  clearLoginFailures(key, organizationId);
  recordFailedLogin(key, organizationId, new Date('2026-09-09T10:00:00.000Z'));
  clearLoginFailures(key, organizationId);
  assert.equal(checkLoginRateLimit(key, organizationId, new Date('2026-09-09T10:01:00.000Z')).allowed, true);
});
