import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserStore, toPublicUser } from '../../src/services/user-store';
import { createHarness } from '../api/fixtures';

const stores: UserStore[] = [];
const directories: string[] = [];

function openStore(path?: string) {
  const store = new UserStore(path);
  stores.push(store);
  return store;
}

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'chatgym-auth-persistence-'));
  directories.push(directory);
  return join(directory, 'nested', 'accounts', 'users.sqlite');
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const input = { username: '  Alice  ', passwordHash: 'synthetic-test-hash' };
const credentials = { username: 'RestartAlice', password: 'Persistence-test-password-42' };

async function authRequest(app: ReturnType<typeof createHarness>['app'], path: string,
  options: { body?: unknown; token?: string } = {}) {
  const response = await app.handle(new Request(`http://localhost/api/auth/${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
  return { status: response.status, body: await response.json() as Record<string, any> };
}

describe('persistent user accounts', () => {
  test('default stores remain isolated and preserve username normalization', () => {
    const first = openStore();
    const second = openStore();
    const created = first.create(input)!;
    expect(created.username).toBe('Alice');
    expect(created.usernameKey).toBe('alice');
    expect(first.findByUsername(' ALICE ')).toEqual(created);
    expect(first.getById(created.id)).toEqual(created);
    expect(first.create({ ...input, username: 'aLiCe' })).toBeUndefined();
    expect(first.create({ ...input, username: '   ' })).toBeUndefined();
    expect(first.getSummary()).toEqual({ usersCount: 1 });
    expect(second.findByUsername('Alice')).toBeUndefined();
    expect(second.getSummary()).toEqual({ usersCount: 0 });
    expect(second.create(input)).toBeDefined();
  });

  test('returned records and public profiles cannot mutate stored account data', () => {
    const store = openStore();
    const created = store.create(input)!;
    const id = created.id;
    created.passwordHash = 'tampered';
    created.username = 'Changed';
    const found = store.findByUsername('alice')!;
    expect(found.username).toBe('Alice');
    expect(found.passwordHash).toBe(input.passwordHash);
    found.usernameKey = 'changed';
    const byId = store.getById(id)!;
    byId.createdAt = 'changed';
    const loggedIn = store.markLogin(id)!;
    const timestamp = loggedIn.lastLoginAt;
    loggedIn.lastLoginAt = null;
    const persisted = store.getById(id)!;
    expect(persisted.usernameKey).toBe('alice');
    expect(Number.isFinite(Date.parse(persisted.createdAt))).toBe(true);
    expect(persisted.lastLoginAt).toBe(timestamp);
    const publicUser = toPublicUser(persisted);
    expect(Object.keys(publicUser).sort()).toEqual(['createdAt', 'id', 'lastLoginAt', 'username']);
    expect(JSON.stringify(publicUser)).not.toContain(input.passwordHash);
    publicUser.username = 'Another';
    expect(store.getById(id)!.username).toBe('Alice');
    expect(store.markLogin('unknown-id')).toBeUndefined();
    expect(store.getSummary()).toEqual({ usersCount: 1 });
  });

  test('identity, password hash and login timestamp survive reopening a private database', () => {
    const path = databasePath();
    const first = openStore(path);
    const created = first.create(input)!;
    const loggedIn = first.markLogin(created.id)!;
    expect(statSync(path).mode & 0o777).toBe(0o600);
    first.close();
    const reopened = openStore(path);
    expect(reopened.getById(created.id)).toEqual(loggedIn);
    expect(reopened.findByUsername(' ALICE ')).toEqual(loggedIn);
    expect(reopened.getSummary()).toEqual({ usersCount: 1 });
    expect(reopened.create({ ...input, username: 'alice', passwordHash: 'replacement' })).toBeUndefined();
    expect(reopened.getById(created.id)!.passwordHash).toBe(input.passwordHash);
    expect(reopened.getById(created.id)!.createdAt).toBe(created.createdAt);
    // close must remain safe for fixture cleanup after explicitly closing a store.
    reopened.close();
    reopened.close();
  });

  test('SQL parameters preserve literal usernames without executing their contents', () => {
    const store = openStore();
    const username = "Robert'); DROP TABLE users;--";
    const created = store.create({ ...input, username })!;
    expect(store.findByUsername(username)).toEqual(created);
    expect(store.create(input)).toBeDefined();
    expect(store.getSummary()).toEqual({ usersCount: 2 });
  });

  test('concurrent registrations across two database connections create one stable account', async () => {
    const path = databasePath();
    const first = openStore(path);
    const second = openStore(path);
    const firstApp = createHarness(first).app;
    const secondApp = createHarness(second).app;
    const results = await Promise.all([
      authRequest(firstApp, 'register', { body: credentials }),
      authRequest(secondApp, 'register', { body: { ...credentials, username: credentials.username.toLowerCase() } }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const account = results.find(result => result.status === 201)!.body.user;
    expect(first.getSummary()).toEqual({ usersCount: 1 });
    expect(second.getById(account.id)!.usernameKey).toBe(credentials.username.toLowerCase());
    expect(first.findByUsername(credentials.username)!.id).toBe(account.id);
    const login = await authRequest(secondApp, 'login', { body: credentials });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(account.id);
    expect(Object.keys(login.body.user).sort()).toEqual(['createdAt', 'id', 'lastLoginAt', 'username']);
  }, 10_000);

  test('a fresh Bun process accepts the original JWT and password after server restart', async () => {
    const path = databasePath();
    const originalStore = openStore(path);
    const originalApp = createHarness(originalStore).app;
    const registered = await authRequest(originalApp, 'register', { body: credentials });
    expect(registered.status).toBe(201);
    const login = await authRequest(originalApp, 'login', { body: credentials });
    expect(login.status).toBe(200);
    const account = login.body.user;
    originalStore.close();

    const userStoreModule = fileURLToPath(new URL('../../src/services/user-store.ts', import.meta.url));
    const fixtureModule = fileURLToPath(new URL('../api/fixtures.ts', import.meta.url));
    const child = Bun.spawn([process.execPath, '--eval', `
      import { UserStore } from ${JSON.stringify(userStoreModule)};
      import { createHarness } from ${JSON.stringify(fixtureModule)};
      const store = new UserStore(process.env.AUTH_TEST_DATABASE_PATH);
      try {
        const app = createHarness(store).app;
        const me = await app.handle(new Request('http://localhost/api/auth/me', {
          headers: { authorization: 'Bearer ' + process.env.AUTH_TEST_ACCESS_TOKEN },
        }));
        const request = { username: process.env.AUTH_TEST_USERNAME, password: process.env.AUTH_TEST_PASSWORD };
        const login = await app.handle(new Request('http://localhost/api/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        }));
        const duplicate = await app.handle(new Request('http://localhost/api/auth/register', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        }));
        console.log(JSON.stringify({ me: { status: me.status, body: await me.json() },
          login: { status: login.status, body: await login.json() },
          duplicate: { status: duplicate.status, body: await duplicate.json() }, summary: store.getSummary() }));
      } finally { store.close(); }
    `], {
      env: { ...process.env, AUTH_TEST_DATABASE_PATH: path, AUTH_TEST_ACCESS_TOKEN: login.body.token,
        AUTH_TEST_USERNAME: credentials.username.toUpperCase(), AUTH_TEST_PASSWORD: credentials.password },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(errors).toBe('');
    expect(exitCode).toBe(0);
    const restarted = JSON.parse(output);
    expect(restarted.me.status).toBe(200);
    expect(restarted.me.body.user).toEqual(account);
    expect(restarted.login.status).toBe(200);
    expect(restarted.login.body.user.id).toBe(account.id);
    expect(restarted.login.body.user.createdAt).toBe(account.createdAt);
    expect(restarted.duplicate.status).toBe(409);
    expect(restarted.summary).toEqual({ usersCount: 1 });
    expect(output).not.toContain('passwordHash');
    expect(output).not.toContain('usernameKey');
    expect(output).not.toContain(credentials.password);
  }, 10_000);
});
