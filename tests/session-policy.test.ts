import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionActive, SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from '../src/lib/session-policy';

test('session remains active inside absolute and idle limits', () => {
  const now = Date.now();
  assert.equal(
    isSessionActive(now, new Date(now - SESSION_IDLE_TTL_MS + 1000).toISOString(), new Date(now + SESSION_ABSOLUTE_TTL_MS).toISOString()),
    true
  );
});

test('idle session expires after 24 hours without activity', () => {
  const now = Date.now();
  assert.equal(
    isSessionActive(now, new Date(now - SESSION_IDLE_TTL_MS).toISOString(), new Date(now + SESSION_ABSOLUTE_TTL_MS).toISOString()),
    false
  );
});

test('absolute session expiry cannot be extended by activity', () => {
  const now = Date.now();
  assert.equal(
    isSessionActive(now, new Date(now - 1000).toISOString(), new Date(now - 1).toISOString()),
    false
  );
});
