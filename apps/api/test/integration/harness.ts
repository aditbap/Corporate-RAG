/**
 * Integration-test harness: provisions throw-away Keycloak users, calls the running API
 * over HTTP, and cleans everything up afterwards.
 *
 * Requires the local stack (docker compose up) and `pnpm dev` for api + worker.
 * Refuses to run against a non-local Keycloak/API so it can never create users in a
 * real environment.
 */
import crypto from 'node:crypto';

const KEYCLOAK_URL = (process.env.KEYCLOAK_URL ?? 'http://localhost:8180').replace(/\/$/, '');
const REALM = process.env.KEYCLOAK_REALM ?? 'rag-platform';
const API = (process.env.TEST_API_URL ?? 'http://localhost:3002/api/v1').replace(/\/$/, '');
const KC_ADMIN = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const CLIENT_ID = 'rag-e2e-test';
const PASSWORD = `Pw-${crypto.randomBytes(8).toString('hex')}`;

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
if (!isLocal(KEYCLOAK_URL) || !isLocal(API)) {
  throw new Error(`Integration tests only run against a local stack (KEYCLOAK_URL=${KEYCLOAK_URL}, API=${API})`);
}

export interface TestUser { username: string; email: string; id: string; token: string }
export interface Res<T = any> { status: number; body: T; headers: Headers; text: string }

let adminToken = '';
async function admin(path: string, init: RequestInit = {}) {
  if (!adminToken) {
    const r = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_ADMIN_PASSWORD }),
    });
    if (!r.ok) throw new Error(`Keycloak admin login failed (${r.status}) — is the stack up?`);
    adminToken = ((await r.json()) as { access_token: string }).access_token;
  }
  return fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', ...init.headers },
  });
}

const created: { users: string[]; clientId?: string } = { users: [] };
export const runTag = crypto.randomBytes(3).toString('hex');

export async function setupClient() {
  const existing = (await (await admin(`/clients?clientId=${CLIENT_ID}`)).json()) as { id: string }[];
  if (existing[0]) return;
  const r = await admin('/clients', {
    method: 'POST',
    body: JSON.stringify({ clientId: CLIENT_ID, publicClient: true, directAccessGrantsEnabled: true, standardFlowEnabled: false }),
  });
  if (r.status !== 201) throw new Error(`create test client failed: ${r.status}`);
  created.clientId = CLIENT_ID;
}

export async function createUser(name: string): Promise<TestUser> {
  const username = `qa-${runTag}-${name}`;
  const email = `${username}@qa.test`;
  const r = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      username, email, firstName: name, lastName: 'QA', enabled: true, emailVerified: true,
      credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
    }),
  });
  if (r.status !== 201) throw new Error(`create user failed: ${r.status} ${await r.text()}`);
  const id = r.headers.get('location')!.split('/').pop()!;
  created.users.push(id);
  return { username, email, id, token: await login(username) };
}

export async function login(username: string): Promise<string> {
  const r = await fetch(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed for ${username}: ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function deleteKeycloakUser(id: string) {
  await admin(`/users/${id}`, { method: 'DELETE' });
  created.users = created.users.filter((u) => u !== id);
}

export async function teardown() {
  for (const id of created.users) await admin(`/users/${id}`, { method: 'DELETE' }).catch(() => undefined);
  if (created.clientId) {
    const c = (await (await admin(`/clients?clientId=${CLIENT_ID}`)).json()) as { id: string }[];
    if (c[0]) await admin(`/clients/${c[0].id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  // Remove rows our users created in the app DB (shared libraries they own, personal workspaces,
  // documents, conversations). Scoped strictly to this run's @qa.test addresses.
  const { db, sql } = await import('@rag/database');
  const tag = `qa-${runTag}-%@qa.test`;
  await db.execute(sql`
    WITH qu AS (SELECT id FROM users WHERE email LIKE ${tag}),
    qo AS (SELECT DISTINCT org_id AS id FROM memberships WHERE user_id IN (SELECT id FROM qu)),
    d1 AS (DELETE FROM conversations WHERE user_id IN (SELECT id FROM qu) RETURNING 1),
    d2 AS (DELETE FROM documents WHERE org_id IN (SELECT id FROM qo) RETURNING 1),
    d3 AS (DELETE FROM folders WHERE org_id IN (SELECT id FROM qo) RETURNING 1),
    d4 AS (DELETE FROM organizations WHERE id IN (SELECT id FROM qo) RETURNING 1)
    DELETE FROM users WHERE id IN (SELECT id FROM qu)`);
}

export async function api<T = any>(user: TestUser | null, method: string, path: string, opts: { body?: unknown; org?: string; headers?: Record<string, string> } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (user) headers.Authorization = `Bearer ${user.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.org) headers['X-Org-Id'] = opts.org;
  const r = await fetch(`${API}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: r.status, body, headers: r.headers, text };
}

export async function upload(user: TestUser, org: string | undefined, name: string, mime: string, content: string): Promise<Res> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: mime }), name);
  const headers: Record<string, string> = { Authorization: `Bearer ${user.token}` };
  if (org) headers['X-Org-Id'] = org;
  const r = await fetch(`${API}/documents/upload`, { method: 'POST', headers, body: form });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, body, headers: r.headers, text };
}

export async function waitForStatus(user: TestUser, org: string | undefined, docId: string, want = 'ready', tries = 45) {
  for (let i = 0; i < tries; i++) {
    const r = await api(user, 'GET', '/documents', { org });
    const d = (r.body?.data ?? []).find((x: { id: string }) => x.id === docId);
    if (d && (d.status === want || d.status === 'failed')) return d.status as string;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return 'timeout';
}

export const ask = (user: TestUser, org: string | undefined, question: string, conversationId?: string) =>
  api(user, 'POST', '/chat/completions', { org, body: { messages: [{ role: 'user', content: question }], ...(conversationId ? { conversationId } : {}) } });

export async function createLibrary(owner: TestUser, name: string): Promise<string> {
  const r = await api(owner, 'POST', '/libraries', { body: { name } });
  if (r.status !== 201) throw new Error(`create library failed: ${r.status} ${r.text}`);
  return r.body.data.id;
}

export async function addMember(owner: TestUser, libraryId: string, member: TestUser, role: 'admin' | 'member' | 'viewer') {
  const inv = await api(owner, 'POST', `/libraries/${libraryId}/invites`, { body: { role } });
  const j = await api(member, 'POST', '/libraries/join', { body: { code: inv.body.data.code } });
  if (j.status !== 200) throw new Error(`join failed: ${j.status} ${j.text}`);
}
