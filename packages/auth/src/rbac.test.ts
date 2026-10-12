import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, canMutateDocument, type Role } from './rbac.js';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];

describe('hasPermission', () => {
  it('lets every role read documents and members', () => {
    for (const r of ROLES) {
      assert.ok(hasPermission(r, 'documents:read'), r);
      assert.ok(hasPermission(r, 'members:read'), r);
    }
  });

  it('lets every role chat, including viewers (chat only creates private conversations)', () => {
    for (const r of ROLES) assert.ok(hasPermission(r, 'chat:create'), r);
  });

  it('only members and above can upload', () => {
    assert.ok(hasPermission('member', 'documents:create'));
    assert.ok(!hasPermission('viewer', 'documents:create'));
  });

  it('only owners/admins manage members and folders; only owners delete the library', () => {
    for (const a of ['members:manage', 'folders:manage'] as const) {
      assert.ok(hasPermission('owner', a) && hasPermission('admin', a), a);
      assert.ok(!hasPermission('member', a) && !hasPermission('viewer', a), a);
    }
    assert.ok(hasPermission('owner', 'library:delete'));
    assert.ok(!hasPermission('admin', 'library:delete'));
  });

  it('denies unknown roles', () => {
    assert.equal(hasPermission('ghost' as Role, 'documents:read'), false);
  });
});

describe('canMutateDocument', () => {
  const me = 'user-me';
  const other = 'user-other';

  it('admins and owners may update/delete any document', () => {
    for (const r of ['owner', 'admin'] as Role[]) {
      for (const verb of ['update', 'delete'] as const) assert.ok(canMutateDocument(r, verb, other, me), `${r} ${verb}`);
    }
  });

  it('members may only update/delete documents they uploaded', () => {
    for (const verb of ['update', 'delete'] as const) {
      assert.ok(canMutateDocument('member', verb, me, me), `own ${verb}`);
      assert.ok(!canMutateDocument('member', verb, other, me), `foreign ${verb}`);
      assert.ok(!canMutateDocument('member', verb, null, me), `unowned ${verb}`);
    }
  });

  it('viewers can never mutate, even their own', () => {
    for (const verb of ['update', 'delete'] as const) assert.ok(!canMutateDocument('viewer', verb, me, me));
  });
});
