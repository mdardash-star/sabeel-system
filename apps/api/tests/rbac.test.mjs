import test from 'node:test';
import assert from 'node:assert/strict';
import { can, requirePermission } from '../src/auth/rbac.mjs';

test('technician can update assigned jobs but cannot approve settlements', () => {
  assert.equal(can('technician', 'jobs:assigned:update'), true);
  assert.equal(can('technician', 'settlements:approve'), false);
});

test('finance can approve settlements but cannot assign jobs', () => {
  assert.equal(can('finance', 'settlements:approve'), true);
  assert.equal(can('finance', 'jobs:assign'), false);
});

test('admin has all permissions', () => {
  assert.equal(can('admin', 'jobs:assign'), true);
  assert.equal(can('admin', 'settlements:approve'), true);
});

test('permission guard rejects unauthorized action', () => {
  assert.throws(() => requirePermission('customer', 'jobs:assign'));
});
