import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/lib/password';

test('correct password verifies successfully', () => {
  const { hash, salt } = hashPassword('ChangeMe123!');
  assert.equal(verifyPassword('ChangeMe123!', hash, salt), true);
});

test('incorrect password is rejected', () => {
  const { hash, salt } = hashPassword('ChangeMe123!');
  assert.equal(verifyPassword('WrongPassword', hash, salt), false);
});

test('two hashes of the same password use different salts', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('empty string password still hashes and verifies deterministically', () => {
  const { hash, salt } = hashPassword('');
  assert.equal(verifyPassword('', hash, salt), true);
  assert.equal(verifyPassword('not-empty', hash, salt), false);
});
