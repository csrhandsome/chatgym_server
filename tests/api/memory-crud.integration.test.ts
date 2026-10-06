import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { MemoryUnavailableError } from '../../src/agent/shared/workout-memory-store';
import { resolveMem0Config } from '../../src/agent/shared/mem0-adapter';
import { FakeMem0Adapter } from '../helpers/fake-mem0-adapter';
import { bobCredentials, createHarness, credentials, planRequest, session, withModelReplies } from './fixtures';

type Account = { token: string; user: { id: string; username: string } };
let h: ReturnType<typeof createHarness>;
let users: ReturnType<typeof createHarness>['runtime']['userStore'];
let alice: Account;
let bob: Account;
let adapter: FakeMem0Adapter;
let currentCase = 'setup';
const evidence: unknown[] = [];
const outcomes: Array<{ name: string; passed: boolean; error?: string }> = [];

function memoryTest(name: string, run: () => Promise<void>) {
  test(name, async () => {
    currentCase = name;
    try { await run(); outcomes.push({ name, passed: true }); }
    catch (error) { outcomes.push({ name, passed: false, error: String(error) }); throw error; }
  });
}

async function call(path: string, options: { method?: string; token?: string | null; body?: unknown; raw?: string } = {}) {
  const response = await h.app.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined || options.raw !== undefined ? { 'content-type': 'application/json' } : {}),
    }, body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  }));
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  evidence.push({ name: currentCase, path, method: options.method ?? 'GET', authenticated: Boolean(options.token),
    request: options.body ?? options.raw, status: response.status, response: body });
  return { status: response.status, headers: response.headers, body };
}

beforeAll(async () => {
  h = createHarness();
  try {
    for (const body of [credentials, bobCredentials]) {
      expect((await call('/api/auth/register', { method: 'POST', body })).status).toBe(201);
    }
    const a = await call('/api/auth/login', { method: 'POST', body: credentials });
    const b = await call('/api/auth/login', { method: 'POST', body: bobCredentials });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    alice = a.body; bob = b.body; users = h.runtime.userStore;
    // Login responses carry test JWTs: do not persist them in report evidence.
    evidence.length = 0;
  } finally { h.close(); }
});
beforeEach(() => { adapter = new FakeMem0Adapter(); h = createHarness(users, adapter); });
afterEach(() => h.close());
afterAll(async () => {
  const report = { generatedAt: new Date().toISOString(), bunVersion: Bun.version,
    boundary: 'real createApp + asynchronous WorkoutMemoryStore + in-process FakeMem0Adapter; no remote Mem0 or existing database',
    total: outcomes.length, passed: outcomes.filter(item => item.passed).length,
    failed: outcomes.filter(item => !item.passed).length, outcomes, evidence };
  await Bun.write('/tmp/chatgym-api-memory-crud.json', JSON.stringify(report, null, 2));
  console.log(`Memory CRUD: ${report.passed} passed, ${report.failed} failed; /tmp/chatgym-api-memory-crud.json`);
});

const seed = async (userId: string, memory: string) => (await adapter.add(userId, [{ role: 'user', content: memory }], {
  scope: 'conversation', infer: false, metadata: { source: 'api-test' },
}))[0]!;
const routes = () => [
  ['/api/agent/memory/search?query=fitness', 'GET', undefined],
  ['/api/agent/memory/items', 'GET', undefined],
  ['/api/agent/memory/items/unknown-memory', 'PATCH', { memory: 'updated' }],
  ['/api/agent/memory/items/unknown-memory', 'DELETE', undefined],
  ['/api/agent/memory/items', 'POST', { memory: 'My fitness preference is home workouts.' }],
] as const;
function expiredToken() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: alice.user.id, username: alice.user.username, exp: 1 })}`;
  return `${unsigned}.${createHmac('sha256', Bun.env.JWT_SECRET ?? 'chatgym-local-dev-secret-change-me').update(unsigned).digest('base64url')}`;
}

describe('JWT-scoped generic memory CRUD', () => {
  for (const mode of ['absent', 'invalid', 'expired']) for (const index of [0, 1, 2, 3, 4]) {
    memoryTest(`new memory route ${index + 1} rejects ${mode} token without store calls`, async () => {
      const [path, method, body] = routes()[index]!;
      const response = await call(path, { method, body, token: mode === 'absent' ? null : mode === 'invalid' ? 'invalid' : expiredToken() });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'authorization token required' });
      expect(adapter.calls).toHaveLength(0);
    });
  }

  memoryTest('search and list use JWT user despite forged query userId', async () => {
    const own = await seed(alice.user.id, 'ALICE_PRIVATE fitness goal');
    await seed(bob.user.id, 'BOB_PRIVATE fitness goal');
    for (const path of [`/api/agent/memory/search?query=fitness&userId=${bob.user.id}`, `/api/agent/memory/items?userId=${bob.user.id}`]) {
      const response = await call(path, { token: alice.token });
      expect(response.status).toBe(200); expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ id: own.id, userId: alice.user.id, memory: own.memory, metadata: { source: 'api-test' } });
      expect(JSON.stringify(response.body)).not.toContain('BOB_PRIVATE');
    }
    const search = adapter.calls.findLast(item => item.operation === 'search')!;
    expect(search.userId).toBe(alice.user.id); expect(search.options).toMatchObject({ query: 'fitness', limit: 10 });
    const other = await call('/api/agent/memory/items', { token: bob.token });
    expect(other.status).toBe(200); expect(other.body.items).toHaveLength(1);
    expect(other.body.items[0].userId).toBe(bob.user.id);
  });

  memoryTest('static search/items routes return empty lists instead of matching /memory/:userId', async () => {
    for (const path of ['/api/agent/memory/items', '/api/agent/memory/search?query=fitness']) {
      const response = await call(path, { token: alice.token });
      expect(response.status).toBe(200); expect(response.body).toEqual({ items: [] });
    }
  });

  memoryTest('list includes workout and conversation records; search stays within conversation scope', async () => {
    const workoutId = await h.runtime.workoutMemoryStore.storeSession(alice.user.id, { ...session(), sessionType: 'strength', intensity: 'medium' });
    const fact = await seed(alice.user.id, 'fitness preference: home');
    const listed = await call('/api/agent/memory/items', { token: alice.token });
    expect(listed.status).toBe(200); expect(listed.body.items).toHaveLength(2);
    expect(listed.body.items.map((item: any) => item.id)).toContain(workoutId);
    const searched = await call('/api/agent/memory/search?query=fitness', { token: alice.token });
    expect(searched.status).toBe(200); expect(searched.body.items.map((item: any) => item.id)).toEqual([fact.id]);
  });

  memoryTest('owner update preserves identity and metadata despite forged body owner', async () => {
    const own = await seed(alice.user.id, 'fitness preference: gym');
    const response = await call(`/api/agent/memory/items/${own.id}`, { method: 'PATCH', token: alice.token,
      body: { memory: 'fitness preference: home', userId: bob.user.id, metadata: { source: 'forged' } } });
    expect(response.status).toBe(200); expect(response.body.status).toBe('updated');
    expect(response.body.item).toMatchObject({ id: own.id, userId: alice.user.id, memory: 'fitness preference: home', metadata: { source: 'api-test' } });
    expect(typeof response.body.item.updatedAt).toBe('string');
    const listed = await call('/api/agent/memory/items', { token: alice.token });
    expect(listed.body.items[0].memory).toBe('fitness preference: home');
  });

  memoryTest('create stores only JWT owner facts and ignores forged IDs and metadata', async () => {
    const text = 'My fitness preference is home workouts.';
    const response = await call('/api/agent/memory/items', { method: 'POST', token: alice.token,
      body: { memory: text, userId: bob.user.id, id: 'forged-memory', metadata: { userId: bob.user.id } } });
    expect(response.status).toBe(201); expect(response.body.status).toBe('stored');
    expect(response.body.item).toMatchObject({ userId: alice.user.id, memory: text,
      metadata: { kind: 'manual_memory', source: 'memory-api', sourceInput: text } });
    expect(response.body.item.id).not.toBe('forged-memory');
    const added = adapter.calls.findLast(item => item.operation === 'add')!;
    expect(added.userId).toBe(alice.user.id); expect(added.options).toMatchObject({ scope: 'conversation', infer: false });
    const foreign = await call('/api/agent/memory/items', { token: bob.token });
    expect(foreign.body).toEqual({ items: [] });
    expect((await call('/api/agent/memory/search?query=fitness', { token: alice.token })).body.items).toHaveLength(1);
  });

  memoryTest('manual creation preserves whitespace and Unicode exactly with generated provenance', async () => {
    const text = '  我的目标是增肌 🏋️\n保留原文。  ';
    const first = await call('/api/agent/memory/items', { method: 'POST', token: alice.token, body: { memory: text } });
    const second = await call('/api/agent/memory/items', { method: 'POST', token: alice.token, body: { memory: text } });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(first.body.item.memory).toBe(text); expect(first.body.item.metadata.sourceInput).toBe(text);
    expect(first.body.item.metadata.sourceId).not.toBe(second.body.item.metadata.sourceId);
    expect(first.body.item.id).not.toBe(second.body.item.id);
    expect(first.body.item.metadata.kind).toBe('manual_memory');
  });

  memoryTest('POST awaits the asynchronous adapter confirmation before returning 201', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    class DelayedAdapter extends FakeMem0Adapter {
      override async add(...args: Parameters<FakeMem0Adapter['add']>): ReturnType<FakeMem0Adapter['add']> {
        started.resolve();
        await release.promise;
        return super.add(...args);
      }
    }
    const delayed = new DelayedAdapter();
    h = createHarness(users, delayed);
    let settled = false;
    const result = call('/api/agent/memory/items', { method: 'POST', token: alice.token, body: { memory: 'fitness preference: home' } })
      .then(value => { settled = true; return value; });
    await started.promise;
    try { expect(settled).toBe(false); expect(delayed.records.size).toBe(0); }
    finally { release.resolve(); }
    expect((await result).status).toBe(201); expect(delayed.records.size).toBe(1);
  });

  for (const body of [{}, { memory: '' }, { memory: ' \n\t' }, { memory: 7 }, { memory: null }, { memory: [] },
    { memory: 'x'.repeat(10001) }, null, []]) memoryTest(`create rejects invalid payload ${JSON.stringify(body).slice(0, 50)}`, async () => {
    const response = await call('/api/agent/memory/items', { method: 'POST', token: alice.token, body });
    expect(response.status).toBe(422); expect(adapter.calls).toHaveLength(0);
  });
  memoryTest('create rejects malformed JSON and accepts the text length boundary', async () => {
    const bad = await call('/api/agent/memory/items', { method: 'POST', token: alice.token, raw: '{broken' });
    expect(bad.status >= 400 && bad.status < 500).toBe(true);
    const good = await call('/api/agent/memory/items', { method: 'POST', token: alice.token, body: { memory: 'x'.repeat(10000) } });
    expect(good.status).toBe(201); expect(good.body.item.memory).toHaveLength(10000);
  });

  for (const method of ['PATCH', 'DELETE']) memoryTest(`${method} another user memory returns 404 without modifying it`, async () => {
    const foreign = await seed(bob.user.id, 'BOB_PRIVATE unchanged');
    const response = await call(`/api/agent/memory/items/${foreign.id}`, { method, token: alice.token,
      body: method === 'PATCH' ? { memory: 'hijacked', userId: bob.user.id } : undefined });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Memory not found for the authenticated user.' });
    expect(await adapter.get(bob.user.id, foreign.id)).toMatchObject({ memory: 'BOB_PRIVATE unchanged' });
  });

  for (const method of ['PATCH', 'DELETE']) memoryTest(`${method} nonexistent memory returns the same 404`, async () => {
    const response = await call('/api/agent/memory/items/nonexistent', { method, token: alice.token,
      body: method === 'PATCH' ? { memory: 'updated' } : undefined });
    expect(response.status).toBe(404); expect(response.body.message).toBe('Memory not found for the authenticated user.');
  });

  memoryTest('owner delete returns after asynchronous removal; repeated delete is 404', async () => {
    const own = await seed(alice.user.id, 'fitness preference: gym');
    const response = await call(`/api/agent/memory/items/${own.id}`, { method: 'DELETE', token: alice.token });
    expect(response.status).toBe(200); expect(response.body).toEqual({ status: 'deleted', id: own.id });
    expect((await call('/api/agent/memory/items', { token: alice.token })).body).toEqual({ items: [] });
    expect((await call(`/api/agent/memory/items/${own.id}`, { method: 'DELETE', token: alice.token })).status).toBe(404);
  });

  for (const body of [{}, { memory: '' }, { memory: ' \n\t' }, { memory: 7 }, { memory: null }, { memory: [] },
    { memory: 'x'.repeat(10001) }, null, []]) memoryTest(`PATCH rejects invalid payload ${JSON.stringify(body).slice(0, 50)}`, async () => {
    const own = await seed(alice.user.id, 'unchanged');
    const response = await call(`/api/agent/memory/items/${own.id}`, { method: 'PATCH', token: alice.token, body });
    expect(response.status).toBe(422); expect((await adapter.get(alice.user.id, own.id)).memory).toBe('unchanged');
  });
  memoryTest('PATCH rejects malformed JSON and accepts the 10000-character boundary', async () => {
    const own = await seed(alice.user.id, 'unchanged');
    const bad = await call(`/api/agent/memory/items/${own.id}`, { method: 'PATCH', token: alice.token, raw: '{broken' });
    expect(bad.status >= 400 && bad.status < 500).toBe(true);
    const good = await call(`/api/agent/memory/items/${own.id}`, { method: 'PATCH', token: alice.token, body: { memory: 'x'.repeat(10000) } });
    expect(good.status).toBe(200); expect(good.body.item.memory).toHaveLength(10000);
  });

  for (const query of ['', 'query=', 'query=%20%20', `query=${'x'.repeat(2001)}`]) memoryTest(`search rejects missing/blank/oversize query ${query.slice(0, 25)}`, async () => {
    const response = await call(`/api/agent/memory/search?${query}`, { token: alice.token });
    expect(response.status).toBe(422); expect(adapter.calls).toHaveLength(0);
  });
  for (const path of ['/api/agent/memory/items', '/api/agent/memory/search?query=fitness']) {
    for (const limit of ['', '0', '-1', '1.5', 'abc', '2junk', '51', '999999999999999999999']) {
      memoryTest(`${path} rejects invalid limit ${limit || '(empty)'}`, async () => {
        const response = await call(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}`, { token: alice.token });
        expect(response.status).toBe(422); expect(adapter.calls).toHaveLength(0);
      });
    }
    memoryTest(`${path} forwards valid limits and enforces 50-item maximum`, async () => {
      for (let i = 0; i < 55; i++) await seed(alice.user.id, `fitness-${i}`);
      for (const [limit, count] of [[1, 1], [2, 2], [50, 50]]) {
        const response = await call(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}`, { token: alice.token });
        expect(response.status).toBe(200); expect(response.body.items).toHaveLength(count!);
      }
    });
  }

  class UnavailableAdapter extends FakeMem0Adapter {
    override async add(...args: Parameters<FakeMem0Adapter['add']>): ReturnType<FakeMem0Adapter['add']> { throw new MemoryUnavailableError(); }
    override async list(...args: Parameters<FakeMem0Adapter['list']>): ReturnType<FakeMem0Adapter['list']> { throw new MemoryUnavailableError(); }
    override async search(...args: Parameters<FakeMem0Adapter['search']>): ReturnType<FakeMem0Adapter['search']> { throw new MemoryUnavailableError(); }
    override async get(...args: Parameters<FakeMem0Adapter['get']>): ReturnType<FakeMem0Adapter['get']> { throw new MemoryUnavailableError(); }
  }
  for (const index of [0, 1, 2, 3, 4, 5, 6]) memoryTest(`memory route ${index + 1} maps asynchronous unavailability to actionable JSON 503`, async () => {
    h = createHarness(users, new UnavailableAdapter());
    const allRoutes = [...routes(), ['/api/agent/memory/session', 'POST', { userId: 'spoof', sessions: [session()] }], ['/api/agent/memory/me', 'GET', undefined]] as const;
    const [path, method, body] = allRoutes[index]!;
    const response = await call(path, { method, body, token: alice.token });
    expect(response.status).toBe(503); expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.body.message).toContain('Mem0'); expect(response.body.message).toContain('configuration');
  });

  memoryTest('missing real Mem0 configuration returns 503 while me and health keep working', async () => {
    // Exercise the real pure config validator with an explicit empty environment.
    // Never construct the SDK: its factory can create history directories first.
    class MissingConfigAdapter extends FakeMem0Adapter {
      override async list(...args: Parameters<FakeMem0Adapter['list']>): ReturnType<FakeMem0Adapter['list']> {
        resolveMem0Config({});
        return super.list(...args);
      }
    }
    const failing = new MissingConfigAdapter();
    h = createHarness(users, failing);
    expect((await call('/api/auth/me', { token: alice.token })).status).toBe(200);
    expect((await call('/api/health')).status).toBe(200);
    const response = await call('/api/agent/memory/items', { token: alice.token });
    expect(response.status).toBe(503); expect(response.body.message).toContain('Mem0');
  });

  for (const mode of ['plan', 'dialog']) memoryTest(`JSON ${mode} request propagates unavailable memory as 503 before calling the model`, async () => {
    h = createHarness(users, new UnavailableAdapter());
    const result = await withModelReplies([], () => call('/api/agent/plan', { method: 'POST', token: alice.token,
      body: { ...planRequest(), mode } }));
    expect(result.value.status).toBe(503);
    expect(result.value.body.message).toContain('Mem0');
    expect(result.value.headers.get('access-control-allow-origin')).toBe('*');
    expect(result.calls).toHaveLength(0);
  });
});
