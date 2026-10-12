import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, upload, ask, waitForStatus, createUser, createLibrary, addMember, deleteKeycloakUser,
  setupClient, teardown, type TestUser,
} from './harness.js';

let owner: TestUser, admin: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
let lib: string;
let memberDoc: string;
const ZEBRA_Q = 'What is the zebra protocol activation phrase?';

before(async () => {
  await setupClient();
  [owner, admin, member, viewer, outsider] = await Promise.all(['owner', 'admin', 'member', 'viewer', 'outsider'].map(createUser));
  lib = await createLibrary(owner, 'Integration Library');
  await addMember(owner, lib, admin, 'admin');
  await addMember(owner, lib, member, 'member');
  await addMember(owner, lib, viewer, 'viewer');
}, { timeout: 120_000 });

after(async () => { await teardown(); }, { timeout: 60_000 });

describe('authentication', () => {
  it('rejects missing and malformed tokens', async () => {
    assert.equal((await api(null, 'GET', '/documents')).status, 401);
    assert.equal((await api({ token: 'abc.def.ghi' } as TestUser, 'GET', '/documents')).status, 401);
    assert.equal((await api(null, 'GET', '/libraries')).status, 401);
  });
});

describe('library membership & isolation', () => {
  it('lists personal + shared libraries for the owner', async () => {
    const r = await api(owner, 'GET', '/libraries');
    assert.equal(r.status, 200);
    assert.deepEqual(new Set(r.body.data.map((l: { kind: string }) => l.kind)), new Set(['personal', 'shared']));
  });

  it('hides a library from non-members (404) and rejects foreign X-Org-Id (403) / malformed ids (400)', async () => {
    assert.equal((await api(outsider, 'GET', `/libraries/${lib}`)).status, 404);
    assert.equal((await api(outsider, 'GET', `/libraries/${lib}/members`)).status, 404);
    assert.equal((await api(outsider, 'POST', `/libraries/${lib}/invites`, { body: {} })).status, 404);
    assert.equal((await api(outsider, 'GET', '/documents', { org: lib })).status, 403);
    assert.equal((await api(outsider, 'GET', '/documents', { org: 'not-a-uuid' })).status, 400);
    assert.equal((await api(owner, 'GET', '/libraries/not-a-uuid')).status, 400);
  });

  it('enforces the role hierarchy', async () => {
    assert.equal((await api(member, 'POST', `/libraries/${lib}/invites`, { body: { role: 'member' } })).status, 403);
    assert.equal((await api(admin, 'POST', `/libraries/${lib}/invites`, { body: { role: 'admin' } })).status, 403, 'admins cannot mint admins');
    assert.equal((await api(owner, 'POST', `/libraries/${lib}/invites`, { body: { role: 'owner' } })).status, 400);
    const members = (await api(owner, 'GET', `/libraries/${lib}/members`)).body.data as { userId: string; email: string }[];
    const ownerId = members.find((m) => m.email === owner.email)!.userId;
    assert.equal((await api(admin, 'PATCH', `/libraries/${lib}/members/${ownerId}`, { body: { role: 'member' } })).status, 403, 'admins cannot demote owners');
    assert.equal((await api(owner, 'PATCH', `/libraries/${lib}/members/${ownerId}`, { body: { role: 'member' } })).status, 409, 'last owner is protected');
    assert.equal((await api(owner, 'DELETE', `/libraries/${lib}/members/${ownerId}`)).status, 409);
    assert.equal((await api(admin, 'DELETE', `/libraries/${lib}`)).status, 403, 'only owners delete the library');
  });

  it('validates invite and library input', async () => {
    assert.equal((await api(owner, 'POST', '/libraries', { body: { name: '   ' } })).status, 400);
    assert.equal((await api(owner, 'POST', '/libraries', { body: { name: 'x'.repeat(101) } })).status, 400);
    assert.equal((await api(owner, 'POST', `/libraries/${lib}/invites`, { body: { expiresInDays: 0 } })).status, 400);
    assert.equal((await api(outsider, 'POST', '/libraries/join', { body: { code: 'bogus' } })).status, 404);
  });

  it('single-use invites cannot be reused by a second person; re-joining is idempotent', async () => {
    const inv = await api(owner, 'POST', `/libraries/${lib}/invites`, { body: { role: 'member', maxUses: 1 } });
    const code = inv.body.data.code;
    const first = await api(outsider, 'POST', '/libraries/join', { body: { code } });
    assert.equal(first.status, 200);
    assert.equal((await api(outsider, 'POST', '/libraries/join', { body: { code } })).body.data.alreadyMember, true);
    const late = await createUser('late');
    assert.equal((await api(late, 'POST', '/libraries/join', { body: { code } })).status, 410);
    // put the outsider back outside for the isolation tests below
    await api(outsider, 'DELETE', `/libraries/${lib}/members/${(await api(owner, 'GET', `/libraries/${lib}/members`)).body.data.find((m: { email: string }) => m.email === outsider.email).userId}`);
    assert.equal((await api(outsider, 'GET', '/documents', { org: lib })).status, 403, 'access is revoked once removed');
  });
});

describe('document & folder permissions', () => {
  it('viewers cannot upload or create folders but can list and chat', async () => {
    assert.equal((await upload(viewer, lib, 'v.txt', 'text/plain', 'x')).status, 403);
    assert.equal((await api(viewer, 'POST', '/folders', { org: lib, body: { name: 'x' } })).status, 403);
    assert.equal((await api(viewer, 'GET', '/folders', { org: lib })).status, 200);
    assert.equal((await ask(viewer, lib, 'hello')).status, 200, 'viewers may ask questions');
  });

  it('members manage only their own uploads; admins manage any', async () => {
    const mine = await upload(member, lib, 'mine.txt', 'text/plain', 'member-owned document');
    assert.equal(mine.status, 201);
    memberDoc = mine.body.data.id;
    const others = await upload(admin, lib, 'admins.txt', 'text/plain', 'admin-owned document');
    const adminDoc = others.body.data.id;

    assert.equal((await api(member, 'PATCH', `/documents/${memberDoc}/notes`, { org: lib, body: { notes: 'mine' } })).status, 200, 'member edits own');
    assert.equal((await api(member, 'PATCH', `/documents/${adminDoc}/notes`, { org: lib, body: { notes: 'nope' } })).status, 403, 'member cannot edit others');
    assert.equal((await api(member, 'DELETE', `/documents/${adminDoc}`, { org: lib })).status, 403, 'member cannot delete others');
    assert.equal((await api(viewer, 'DELETE', `/documents/${memberDoc}`, { org: lib })).status, 403);
    assert.equal((await api(admin, 'PATCH', `/documents/${memberDoc}/notes`, { org: lib, body: { notes: 'admin note' } })).status, 200, 'admin edits any');
    assert.equal((await api(member, 'DELETE', `/documents/${memberDoc}`, { org: lib })).status, 200, 'member deletes own');
    assert.equal((await api(admin, 'DELETE', `/documents/${adminDoc}`, { org: lib })).status, 200, 'admin deletes any');
  });

  it('folders: members create, only admins/owners rename or delete', async () => {
    const f = await api(member, 'POST', '/folders', { org: lib, body: { name: 'Docs' } });
    assert.equal(f.status, 201);
    const id = f.body.data.id;
    assert.equal((await api(member, 'PATCH', `/folders/${id}`, { org: lib, body: { name: 'Renamed' } })).status, 403);
    assert.equal((await api(member, 'DELETE', `/folders/${id}`, { org: lib })).status, 403);
    assert.equal((await api(viewer, 'DELETE', `/folders/${id}`, { org: lib })).status, 403);
    assert.equal((await api(admin, 'PATCH', `/folders/${id}`, { org: lib, body: { name: 'Renamed' } })).status, 200);
    assert.equal((await api(admin, 'DELETE', `/folders/${id}`, { org: lib })).status, 204);
  });

  it('rejects moving a document into another library\'s folder', async () => {
    const d = (await upload(member, lib, 'mv.txt', 'text/plain', 'move me')).body.data.id;
    const foreign = (await api(outsider, 'POST', '/folders', { body: { name: 'Mine' } })).body.data.id;
    assert.equal((await api(member, 'PATCH', `/documents/${d}/move`, { org: lib, body: { folderId: foreign } })).status, 404);
    await api(member, 'DELETE', `/documents/${d}`, { org: lib });
  });

  it('returns 404 (not 500) for malformed ids', async () => {
    for (const p of ['/documents/not-a-uuid/content', '/documents/not-a-uuid/versions', '/conversations/not-a-uuid/messages']) {
      assert.equal((await api(owner, 'GET', p, { org: lib })).status, 404, p);
    }
  });
});

describe('renaming', () => {
  it('members rename their own documents, admins any; others are refused', async () => {
    const mine = (await upload(member, lib, 'old-name.txt', 'text/plain', 'rename me')).body.data.id;
    const adminsDoc = (await upload(admin, lib, 'admin-old.txt', 'text/plain', 'admin doc')).body.data.id;
    const rename = (u: TestUser, id: string, name: unknown) => api(u, 'PATCH', `/documents/${id}`, { org: lib, body: { name } });

    const r = await rename(member, mine, '  New name.txt  ');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.fileName, 'New name.txt', 'trimmed and applied');
    assert.equal(r.body.data.title, 'New name.txt');
    const listed = (await api(owner, 'GET', '/documents', { org: lib })).body.data.find((d: { id: string }) => d.id === mine);
    assert.equal(listed.fileName, 'New name.txt');

    assert.equal((await rename(member, adminsDoc, 'hijack.txt')).status, 403, "member cannot rename someone else's document");
    assert.equal((await rename(viewer, mine, 'viewer.txt')).status, 403);
    assert.equal((await rename(admin, mine, 'by-admin.txt')).status, 200);
    assert.equal((await rename(outsider, mine, 'x.txt')).status, 403, 'non-member of this library');
  });

  it('rejects empty, oversized, slash-containing and non-string names; unknown ids are 404', async () => {
    const id = (await upload(member, lib, 'valid.txt', 'text/plain', 'x')).body.data.id;
    const rename = (name: unknown) => api(member, 'PATCH', `/documents/${id}`, { org: lib, body: { name } });
    for (const bad of ['', '   ', 'a/b.txt', 'a\\b.txt', 'x'.repeat(501), 42, null, undefined]) {
      assert.equal((await rename(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(member, 'PATCH', '/documents/00000000-0000-0000-0000-000000000000', { org: lib, body: { name: 'ok.txt' } })).status, 404);
    assert.equal((await api(member, 'PATCH', '/documents/not-a-uuid', { org: lib, body: { name: 'ok.txt' } })).status, 404);
  });
});

describe('upload rate limit', { skip: !process.env.TEST_UPLOAD_LIMIT && 'set TEST_UPLOAD_LIMIT to the API\'s RATE_LIMIT_UPLOAD_PER_MINUTE to run' }, () => {
  it('blocks uploads beyond the per-minute limit, per user, and does not affect other users', async () => {
    const limit = Number(process.env.TEST_UPLOAD_LIMIT);
    const solo = await createUser('uploader');
    const soloLib = await createLibrary(solo, 'Rate limit lib');
    for (let i = 0; i < limit; i++) {
      assert.equal((await upload(solo, soloLib, `r${i}.txt`, 'text/plain', `doc ${i}`)).status, 201, `upload ${i + 1} within the limit`);
    }
    const over = await upload(solo, soloLib, 'over.txt', 'text/plain', 'one too many');
    assert.equal(over.status, 429);
    assert.equal(over.body.error.code, 'TOO_MANY_REQUESTS');
    // limits are per user per library: a teammate and the same user elsewhere are unaffected
    await addMember(solo, soloLib, viewer, 'member');
    assert.equal((await upload(viewer, soloLib, 'teammate.txt', 'text/plain', 'ok')).status, 201);
  });
});

describe('input validation', () => {
  it('rejects malformed chat bodies with 400 instead of crashing', async () => {
    const post = (body: unknown) => api(owner, 'POST', '/chat/completions', { org: lib, body });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ messages: [] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'user' }] })).status, 400, 'missing content');
    assert.equal((await post({ messages: [{ role: 'user', content: 42 }] })).status, 400, 'non-string content');
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }], conversationId: 'abc' })).status, 400, 'bad conversation id');
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }], documentIds: ['nope'] })).status, 400, 'bad document id');
    assert.equal((await post({ messages: [{ role: 'user', content: 'hi' }], documentIds: 'x' })).status, 400);
  });

  it('validates the upload folder: library root, own folder ok; foreign or malformed rejected', async () => {
    const mine = (await api(admin, 'POST', '/folders', { org: lib, body: { name: 'Upload target' } })).body.data.id;
    const foreign = (await api(outsider, 'POST', '/folders', { body: { name: 'Elsewhere' } })).body.data.id;
    assert.equal((await upload(member, lib, 'root.txt', 'text/plain', 'a', { folderId: 'null' })).status, 201, "'null' means library root");
    assert.equal((await upload(member, lib, 'in.txt', 'text/plain', 'b', { folderId: mine })).status, 201);
    assert.equal((await upload(member, lib, 'bad.txt', 'text/plain', 'c', { folderId: foreign })).status, 400, 'another library\'s folder');
    assert.equal((await upload(member, lib, 'bad2.txt', 'text/plain', 'd', { folderId: 'not-a-uuid' })).status, 400);
  });

  it('bounds the document list page size', async () => {
    assert.equal((await api(owner, 'GET', '/documents?limit=100000&offset=-5', { org: lib })).status, 200);
    assert.equal((await api(owner, 'GET', '/documents?limit=abc', { org: lib })).status, 200);
  });
});

describe('uploaded content safety', () => {
  it('serves HTML as inert text with nosniff + CSP sandbox', async () => {
    const up = await upload(member, lib, 'evil.html', 'text/html', '<script>alert(1)</script>');
    assert.equal(up.status, 201);
    const r = await api(owner, 'GET', `/documents/${up.body.data.id}/content`, { org: lib });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy') ?? '', /sandbox/);
  });
});

describe('chat over shared knowledge', { timeout: 600_000 }, () => {
  it('answers from a teammate\'s upload immediately — no stale cache — and forgets deleted docs', async () => {
    const before = await ask(owner, lib, ZEBRA_Q);
    assert.equal(before.status, 200);
    assert.ok(!before.body.content.includes('ZEBRA-77'));

    const up = await upload(member, lib, 'zebra.txt', 'text/plain', 'The zebra protocol activation phrase is ZEBRA-77.');
    const docId = up.body.data.id;
    assert.equal(await waitForStatus(member, lib, docId), 'ready');

    const after = await ask(owner, lib, ZEBRA_Q);
    assert.ok(after.body.content.includes('ZEBRA-77'), `expected the new knowledge, got: ${after.body.content}`);
    assert.ok(after.body.citations.some((c: { fileName: string }) => c.fileName === 'zebra.txt'));

    assert.equal((await api(member, 'DELETE', `/documents/${docId}`, { org: lib })).status, 200);
    const gone = await ask(owner, lib, ZEBRA_Q);
    assert.ok(!gone.body.content.includes('ZEBRA-77'), 'deleted document must not be served from cache');
  });

  it('persists conversations served from cache so follow-ups do not 404', async () => {
    const q = 'What is the capital of the library cache test?';
    await ask(owner, lib, q);
    const hit = await ask(member, lib, q);
    assert.equal(hit.status, 200);
    assert.equal(hit.body.cached, true);
    const conv = hit.body.conversationId;
    const msgs = await api(member, 'GET', `/conversations/${conv}/messages`, { org: lib });
    assert.equal(msgs.status, 200);
    assert.equal(msgs.body.messages.length, 2);
    assert.equal((await ask(member, lib, 'And a follow-up?', conv)).status, 200);
  });

  it('keeps conversations private: no reading or writing another user\'s chat', async () => {
    const conv = (await ask(owner, lib, 'Hello there')).body.conversationId;
    assert.equal((await ask(member, lib, 'inject', conv)).status, 404);
    assert.equal((await api(member, 'GET', `/conversations/${conv}/messages`, { org: lib })).status, 404);
    assert.equal((await ask(outsider, undefined, 'inject', conv)).status, 404);
  });
});

describe('identity provisioning', () => {
  it('provisions a recreated IdP account that reuses an email (new sub, same email)', async () => {
    const first = await createUser('reuse');
    assert.equal((await api(first, 'GET', '/libraries')).status, 200);
    await deleteKeycloakUser(first.id);
    const second = await createUser('reuse'); // same username/email, new sub
    assert.notEqual(second.id, first.id);
    const r = await api(second, 'GET', '/libraries');
    assert.equal(r.status, 200);
    const created = await api(second, 'POST', '/libraries', { body: { name: 'After reuse' } });
    assert.equal(created.status, 201, 'creating a library needs a provisioned users row');
  });

  it('uses the OIDC name claim as the display name', async () => {
    const members = (await api(owner, 'GET', `/libraries/${lib}/members`)).body.data as { email: string; fullName: string }[];
    assert.equal(members.find((m) => m.email === owner.email)?.fullName, 'owner QA');
  });
});
