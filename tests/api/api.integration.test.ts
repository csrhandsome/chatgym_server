import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  agentEventSchema, planApiResponseSchema, planningDialogResponseSchema, trainingPlanSchema, vlmAnalyzeResponseSchema,
} from '../../src/agent/shared/types';
import {
  bobCredentials, createHarness, credentials, frontendChatRequest, imageDataUrl, imageUrl,
  planRequest, recommendToolReply, session, validPlan, visionReply, withModelReplies,
} from './fixtures';

type Json = Record<string, any>;
type Account = { token: string; user: { id: string; username: string } };
let h: ReturnType<typeof createHarness>;
let alice: Account;
let bob: Account;
let users: ReturnType<typeof createHarness>['runtime']['userStore'];
let currentCase = '';
let restoreFetch: typeof fetch;
const outcomes: Array<{ name: string; passed: boolean; error?: string }> = [];
const evidence: Array<Json> = [];

function scrub(value: any): any {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /password|token|authorization|secret/i.test(key) ? '[redacted]' : scrub(item)]));
  return value;
}

function apiTest(name: string, run: () => Promise<void>) {
  test(name, async () => {
    currentCase = name;
    try { await run(); outcomes.push({ name, passed: true }); }
    catch (error) {
      outcomes.push({ name, passed: false, error: String(error) });
      throw error;
    }
  }, 15_000);
}

async function call(path: string, options: {
  method?: string; body?: unknown; token?: string | null; authorization?: string;
  headers?: Record<string, string>; raw?: string;
} = {}) {
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;
  if (!isForm && (options.body !== undefined || options.raw !== undefined)) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  if (options.authorization !== undefined) headers.set('authorization', options.authorization);
  const response = await h.app.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? (options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET'),
    headers, body: options.raw ?? (isForm ? options.body as FormData : options.body !== undefined ? JSON.stringify(options.body) : undefined),
  }));
  const text = await response.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* SSE / Elysia text errors. */ }
  evidence.push({ name: currentCase, path, method: options.method ?? (options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET'),
    authenticated: headers.has('authorization'), request: isForm ? { multipart: true, fields: Array.from((options.body as FormData).keys()) } : scrub(options.body ?? options.raw),
    status: response.status, headers: Object.fromEntries(response.headers), response: Object.keys(body ?? {}).length ? scrub(body) : text.slice(0, 4000) });
  return { status: response.status, headers: response.headers, body, text };
}

type Result = Awaited<ReturnType<typeof call>>;
function status(result: Result, expected: number) {
  if (result.status !== expected) throw new Error(`Expected HTTP ${expected}, received ${result.status}: ${result.text.slice(0, 1600)}`);
}
function clientError(result: Result) {
  if (result.status < 400 || result.status >= 500) throw new Error(`Expected client error 4xx, received ${result.status}: ${result.text.slice(0, 1600)}`);
}
function cors(result: Result) {
  expect(result.headers.get('access-control-allow-origin')).toBe('*');
}
function sse(result: Result) {
  status(result, 200);
  expect(result.headers.get('content-type')).toContain('text/event-stream');
  expect(result.headers.get('cache-control')).toBe('no-cache, no-transform');
  expect(result.text.startsWith(': connected\n\n')).toBe(true);
  expect(result.text.endsWith('\n\n')).toBe(true);
  const events = result.text.split('\n\n').filter(block => block.startsWith('event:')).map(block => {
    const lines = block.split('\n');
    const event = JSON.parse(lines.find(line => line.startsWith('data:'))!.slice(5));
    expect(lines[0]).toBe(`event: ${event.type}`);
    agentEventSchema.parse(event);
    return event;
  });
  expect(new Set(events.map(event => event.id)).size).toBe(events.length);
  expect(new Set(events.map(event => event.requestId)).size).toBe(1);
  return events as Json[];
}

function signedJwt(payload: Json, secret = Bun.env.JWT_SECRET ?? 'chatgym-local-dev-secret-change-me', header: Json = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (part: Json) => Buffer.from(JSON.stringify(part)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

beforeAll(async () => {
  restoreFetch = globalThis.fetch;
  // Deny network by default, including accidental requests using the real .env.
  const deny = async () => { throw new Error('Network disabled in API contract suite'); };
  globalThis.fetch = Object.assign(deny, { preconnect: restoreFetch.preconnect });
  h = createHarness();
  currentCase = 'setup: real register then login';
  try {
    for (const input of [credentials, bobCredentials]) {
      status(await call('/api/auth/register', { body: input }), 201);
    }
    const a = await call('/api/auth/login', { body: credentials });
    const b = await call('/api/auth/login', { body: bobCredentials });
    status(a, 200); status(b, 200);
    alice = a.body as Account; bob = b.body as Account; users = h.runtime.userStore;
  } finally { h.close(); }
});
beforeEach(() => { h = createHarness(users); });
afterEach(() => { h.close(); });
afterAll(async () => {
  globalThis.fetch = restoreFetch;
  const report = {
    generatedAt: new Date().toISOString(), bunVersion: Bun.version,
    integrationBoundary: 'real createApp.handle + isolated runtime + WorkoutMemoryStore(FakeMem0Adapter) + real SDK/workflows; provider HTTP mocked; no listening port',
    passed: outcomes.filter(item => item.passed).length, failed: outcomes.filter(item => !item.passed).length,
    total: outcomes.length, outcomes, evidence,
  };
  const reportPath = Bun.env.API_REPORT_PATH ?? '/tmp/chatgym-api-integration.json';
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  console.log(`API evidence: ${reportPath}; ${report.passed} passed, ${report.failed} failed, ${report.total} total`);
});

describe('01 auth register/login/me', () => {
  apiTest('register returns 201, safe profile, immediately usable JWT', async () => {
    const r = await call('/api/auth/register', { body: { ...credentials, username: 'api_new_user' } });
    status(r, 201);
    expect(r.body.status).toBe('registered'); expect(r.body.tokenType).toBe('Bearer');
    expect(r.body.token.split('.')).toHaveLength(3);
    expect(Object.keys(r.body.user).sort()).toEqual(['createdAt', 'id', 'lastLoginAt', 'username']);
    expect(r.body.user.lastLoginAt).toBeNull();
    const me = await call('/api/auth/me', { token: r.body.token });
    status(me, 200); expect(me.body.user).toEqual(r.body.user);
  });
  apiTest('login correct password updates lastLoginAt; token restores profile', async () => {
    const r = await call('/api/auth/login', { body: credentials });
    status(r, 200); expect(r.body.status).toBe('authenticated'); expect(r.body.tokenType).toBe('Bearer');
    expect(Number.isFinite(Date.parse(r.body.user.lastLoginAt))).toBe(true);
    const me = await call('/api/auth/me', { token: r.body.token });
    status(me, 200); expect(me.body.user).toEqual(r.body.user);
  });
  for (const username of [credentials.username, credentials.username.toUpperCase()]) {
    apiTest(`duplicate registration is 409: ${username}`, async () => {
      const before = users.getSummary();
      const r = await call('/api/auth/register', { body: { ...credentials, username } });
      status(r, 409); expect(r.body).toEqual({ message: 'username already exists' });
      expect(users.getSummary()).toEqual(before);
    });
  }
  apiTest('login is case insensitive', async () => {
    const r = await call('/api/auth/login', { body: { ...credentials, username: credentials.username.toUpperCase() } });
    status(r, 200); expect(r.body.user.id).toBe(alice.user.id);
  });
  for (const input of [{ ...credentials, password: 'Wrong-password-42' }, { ...credentials, username: 'api_nonexistent' }]) {
    apiTest(`login rejects ${input.username === credentials.username ? 'wrong password' : 'unknown user'} identically`, async () => {
      const before = users.getById(alice.user.id)!.lastLoginAt;
      const r = await call('/api/auth/login', { body: input });
      status(r, 401); expect(r.body).toEqual({ message: 'invalid username or password' });
      expect(users.getById(alice.user.id)!.lastLoginAt).toBe(before);
    });
  }
  const invalid = [
    ['missing password', { username: 'valid_user' }], ['missing username', { password: credentials.password }],
    ['short username', { ...credentials, username: 'ab' }], ['long username', { ...credentials, username: 'a'.repeat(33) }],
    ['invalid username characters', { ...credentials, username: 'bad name' }],
    ['short password', { ...credentials, password: '1234567' }], ['long password', { ...credentials, password: 'x'.repeat(73) }],
    ['wrong field type', { ...credentials, password: 12345678 }], ['null body', null], ['array body', []],
  ] as const;
  for (const endpoint of ['register', 'login']) {
    for (const [name, body] of invalid) apiTest(`${endpoint} invalid credentials: ${name}`, async () => {
      const before = users.getSummary();
      status(await call(`/api/auth/${endpoint}`, { body }), 422);
      expect(users.getSummary()).toEqual(before);
    });
    apiTest(`${endpoint} rejects malformed JSON as 4xx`, async () => {
      clientError(await call(`/api/auth/${endpoint}`, { raw: '{broken' }));
    });
  }
  apiTest('username/password maximum boundaries are accepted', async () => {
    const body = { username: 'boundary'.padEnd(32, 'x'), password: 'p'.repeat(72) };
    status(await call('/api/auth/register', { body }), 201);
    status(await call('/api/auth/login', { body }), 200);
  });
});

describe('02 JWT and protected endpoint matrix', () => {
  const invalidTokens: Array<[string, () => string | undefined]> = [
    ['absent', () => undefined], ['wrong scheme', () => `Basic ${alice.token}`], ['empty Bearer', () => 'Bearer'],
    ['extra token', () => `Bearer ${alice.token} extra`], ['malformed JWT', () => 'Bearer a.b.c'],
    ['wrong signature', () => `Bearer ${signedJwt({ sub: alice.user.id, username: alice.user.username }, 'wrong-secret')}`],
    ['tampered payload', () => `Bearer ${alice.token.split('.')[0]}.${Buffer.from(JSON.stringify({ sub: bob.user.id, username: bob.user.username })).toString('base64url')}.${alice.token.split('.')[2]}`],
    ['expired', () => `Bearer ${signedJwt({ sub: alice.user.id, username: alice.user.username, exp: 1 })}`],
    ['future nbf', () => `Bearer ${signedJwt({ sub: alice.user.id, username: alice.user.username, nbf: Math.floor(Date.now() / 1000) + 3600 })}`],
    ['missing sub', () => `Bearer ${signedJwt({ username: alice.user.username })}`],
    ['invalid sub format', () => `Bearer ${signedJwt({ sub: 'not-uuid', username: alice.user.username })}`],
    ['unknown user', () => `Bearer ${signedJwt({ sub: crypto.randomUUID(), username: 'api_unknown' })}`],
    ['missing username', () => `Bearer ${signedJwt({ sub: alice.user.id })}`],
    ['alg none', () => `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: alice.user.id, username: alice.user.username })).toString('base64url')}.`],
  ];
  for (const [name, authorization] of invalidTokens) apiTest(`me rejects JWT: ${name}`, async () => {
    const r = await call('/api/auth/me', { authorization: authorization() });
    status(r, 401); expect(r.body).toEqual({ message: 'authorization token required' });
  });
  apiTest('Bearer scheme accepts lowercase and extra surrounding whitespace', async () => {
    status(await call('/api/auth/me', { authorization: `  bearer   ${alice.token}  ` }), 200);
  });
  apiTest('issued JWT contains sub, username, issued-at and future expiration', async () => {
    const claims = JSON.parse(Buffer.from(alice.token.split('.')[1]!, 'base64url').toString());
    expect(claims.sub).toBe(alice.user.id); expect(claims.username).toBe(alice.user.username);
    expect(typeof claims.iat).toBe('number'); expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  });
  const protectedRoutes = [
    ['/api/agent/plan', 'POST', () => planRequest()], ['/api/agent/plan/stream', 'POST', () => planRequest()],
    ['/api/agent/vlm/analyze', 'POST', () => ({ images: [{ image: imageUrl }] })],
    ['/api/agent/vlm/analyze/stream', 'POST', () => ({ images: [{ image: imageUrl }] })],
    ['/api/agent/memory/session', 'POST', () => ({ userId: 'spoof', sessions: [session()] })],
    ['/api/agent/memory/me', 'GET', () => undefined], ['/api/text', 'POST', () => ({ text: 'hello' })],
    ['/api/text', 'GET', () => undefined], ['/api/text/00000000-0000-4000-8000-000000000001', 'GET', () => undefined],
  ] as const;
  for (const [path, method, body] of protectedRoutes) for (const mode of ['absent', 'invalid', 'expired']) {
    apiTest(`${method} ${path} rejects ${mode} JWT before invoking model`, async () => {
      const result = await withModelReplies([], () => call(path, { method, body: body(),
        authorization: mode === 'absent' ? undefined : mode === 'invalid' ? 'Bearer invalid' :
          `Bearer ${signedJwt({ sub: alice.user.id, username: alice.user.username, exp: 1 })}` }));
      status(result.value, 401); expect(result.calls).toHaveLength(0);
      expect(h.runtime.workoutMemoryStore.getSummary().totalStoredSessions).toBe(0);
      expect(h.runtime.textStore.getSummary().totalReceived).toBe(0);
    });
  }
});

describe('03 CORS', () => {
  for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/me', '/api/agent/plan',
    '/api/agent/plan/stream', '/api/agent/vlm/analyze', '/api/agent/vlm/analyze/stream', '/api/agent/memory/session', '/api/text']) {
    apiTest(`preflight permits browser Authorization and Content-Type: ${path}`, async () => {
      const r = await call(path, { method: 'OPTIONS', headers: { origin: 'http://localhost:8081',
        'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-client-test' } });
      status(r, 204); cors(r); expect(r.text).toBe('');
      expect(r.headers.get('access-control-allow-headers')).toBe('authorization,content-type,x-client-test');
      expect(r.headers.get('access-control-allow-methods')).toContain('POST');
    });
  }
  apiTest('JSON success, 401, 422 and 404 responses include CORS', async () => {
    cors(await call('/api/auth/me', { token: alice.token }));
    cors(await call('/api/auth/me'));
    cors(await call('/api/agent/plan', { body: {}, token: alice.token }));
    const missing = await call('/api/does-not-exist'); status(missing, 404); cors(missing);
  });
  for (const path of ['/api/agent/plan/stream', '/api/agent/vlm/analyze/stream']) apiTest(`SSE success and workflow error retain CORS: ${path}`, async () => {
    const plan = path.includes('/plan');
    await withModelReplies([JSON.stringify(plan ? validPlan() : visionReply())], async () => {
      const r = await call(path, { token: alice.token, body: plan ? planRequest() : { images: [{ image: imageUrl }] } });
      sse(r); cors(r);
    });
    await withModelReplies([{ httpError: 400, message: 'synthetic provider failure' }], async () => {
      const r = await call(path, { token: alice.token, body: plan ? planRequest() : { images: [{ image: imageUrl }] } });
      expect(sse(r).at(-1)!.type).toBe('error'); cors(r);
    });
  });
});

describe('04 memory contracts and cross-user isolation', () => {
  apiTest('store/list/me/dedupe bind to JWT despite forged userId', async () => {
    const body = { userId: bob.user.id, sessions: [session()] };
    const stored = await call('/api/agent/memory/session', { body, token: alice.token });
    status(stored, 201); expect(stored.body.status).toBe('stored'); expect(stored.body.storedIds).toHaveLength(1);
    expect(stored.body.totalSessionsForUser).toBe(1);
    const duplicate = await call('/api/agent/memory/session', { body, token: alice.token });
    status(duplicate, 201); expect(duplicate.body).toEqual(stored.body);
    const own = await call('/api/agent/memory/me', { token: alice.token }); status(own, 200);
    expect(own.body.items[0].id).toBe(stored.body.storedIds[0]); expect(own.body.items[0].exerciseNames).toEqual(['卧推']);
    expect(own.body.items[0].completedAt).toBe(session().completedAt);
    const byId = await call(`/api/agent/memory/${alice.user.id}`, { token: alice.token });
    status(byId, 200); expect(byId.body).toEqual(own.body);
    const other = await call('/api/agent/memory/me', { token: bob.token }); status(other, 200);
    expect(other.body).toEqual({ items: [], totalSessionsForUser: 0 });
    status(await call(`/api/agent/memory/${alice.user.id}`, { token: bob.token }), 403);
    status(await call(`/api/agent/memory/${bob.user.id}`, { token: alice.token }), 403);
  });
  apiTest('identical sessions by two users have independent IDs', async () => {
    const body = { userId: 'spoof', sessions: [session()] };
    const a = await call('/api/agent/memory/session', { token: alice.token, body });
    const b = await call('/api/agent/memory/session', { token: bob.token, body });
    status(a, 201); status(b, 201); expect(a.body.storedIds[0]).not.toBe(b.body.storedIds[0]);
  });
  for (const [name, body] of [
    ['missing userId', { sessions: [session()] }], ['empty sessions', { userId: 'x', sessions: [] }],
    ['too many sessions', { userId: 'x', sessions: Array.from({ length: 101 }, session) }],
    ['invalid timestamp', { userId: 'x', sessions: [{ ...session(), completedAt: 'yesterday' }] }],
    ['short duration', { userId: 'x', sessions: [{ ...session(), durationMinutes: 9 }] }],
    ['too long duration', { userId: 'x', sessions: [{ ...session(), durationMinutes: 301 }] }],
    ['fractional duration', { userId: 'x', sessions: [{ ...session(), durationMinutes: 30.5 }] }],
    ['empty exercises', { userId: 'x', sessions: [{ ...session(), exerciseNames: [] }] }],
    ['invalid intensity', { userId: 'x', sessions: [{ ...session(), intensity: 'extreme' }] }],
    ['null', null], ['array', []],
  ] as const) apiTest(`memory invalid payload: ${name}`, async () => {
    status(await call('/api/agent/memory/session', { body, token: alice.token }), 422);
    expect(h.runtime.workoutMemoryStore.getSummary().totalStoredSessions).toBe(0);
  });
  apiTest('memory malformed JSON is 4xx without writes', async () => {
    clientError(await call('/api/agent/memory/session', { raw: '{bad', token: alice.token }));
    expect(h.runtime.workoutMemoryStore.getSummary().totalStoredSessions).toBe(0);
  });
  apiTest('memory list limit clamps to 50 and invalid values default to 10', async () => {
    const sessions = Array.from({ length: 55 }, (_, i) => ({ ...session(), sourceId: `limit-${i}`, completedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
    status(await call('/api/agent/memory/session', { token: alice.token, body: { userId: 'x', sessions } }), 201);
    for (const [limit, count] of [['2', 2], ['999', 50], ['-1', 10], ['abc', 10], ['0', 10]] as const) {
      const r = await call(`/api/agent/memory/me?limit=${limit}`, { token: alice.token }); status(r, 200);
      expect(r.body.items).toHaveLength(count); expect(r.body.totalSessionsForUser).toBe(55);
      expect(r.body.items[0].completedAt).toBe(sessions.at(-1)!.completedAt);
    }
  });
});

describe('05 text contracts and cross-user isolation', () => {
  apiTest('text stores safe owner, metadata, Unicode, source and session; hides other users', async () => {
    const body = { text: '你好 🏋️', sessionId: 'api-chat', source: 'frontend', metadata: { count: 1, nested: ['ok'] },
      userId: bob.user.id, username: bob.user.username };
    const a = await call('/api/text', { token: alice.token, body }); status(a, 201);
    expect(a.body.status).toBe('accepted'); expect(a.body.record.userId).toBe(alice.user.id);
    expect(a.body.record.username).toBe(alice.user.username); expect(a.body.record.length).toBe(body.text.length);
    expect(a.body.record.metadata).toEqual(body.metadata); expect(a.body.record.source).toBe('frontend');
    expect(a.body.record.sessionId).toBe('api-chat'); expect(Number.isFinite(Date.parse(a.body.record.receivedAt))).toBe(true);
    const own = await call(`/api/text/${a.body.record.id}`, { token: alice.token }); status(own, 200);
    expect(own.body.record).toEqual(a.body.record);
    const list = await call('/api/text', { token: alice.token }); status(list, 200);
    expect(list.body).toEqual({ items: [a.body.record], count: 1 });
    const other = await call('/api/text', { token: bob.token }); status(other, 200);
    expect(other.body).toEqual({ items: [], count: 0 });
    status(await call(`/api/text/${a.body.record.id}`, { token: bob.token }), 404);
    status(await call(`/api/text/${crypto.randomUUID()}`, { token: alice.token }), 404);
  });
  apiTest('text defaults source to api, permits length 10000', async () => {
    const r = await call('/api/text', { body: { text: 'a'.repeat(10000) }, token: alice.token });
    status(r, 201); expect(r.body.record.source).toBe('api'); expect(r.body.record.length).toBe(10000);
  });
  for (const [name, body] of [
    ['missing text', {}], ['empty', { text: '' }], ['blank', { text: ' \n\t ' }],
    ['too long', { text: 'x'.repeat(10001) }], ['wrong type', { text: 1 }], ['invalid metadata', { text: 'x', metadata: [] }],
    ['empty source', { text: 'x', source: '' }], ['long sessionId', { text: 'x', sessionId: 'x'.repeat(101) }], ['null', null],
  ] as const) apiTest(`text invalid payload: ${name}`, async () => {
    status(await call('/api/text', { body, token: alice.token }), 422);
    expect(h.runtime.textStore.getSummary().totalReceived).toBe(0);
  });
  apiTest('text rejects invalid UUID and malformed JSON as 4xx', async () => {
    status(await call('/api/text/not-a-uuid', { token: alice.token }), 422);
    clientError(await call('/api/text', { raw: '{bad', token: alice.token }));
  });
});

describe('06 plan and plan/stream: real workflows with provider HTTP mock', () => {
  for (const path of ['/api/agent/plan', '/api/agent/plan/stream']) {
    apiTest(`${path} valid payload produces full frontend contract and final event`, async () => {
      const result = await withModelReplies([JSON.stringify(validPlan())], () => call(path, { token: alice.token, body: planRequest() }));
      const r = result.value; status(r, 200); expect(result.calls).toHaveLength(1);
      if (path.endsWith('/stream')) {
        const events = sse(r); expect(events.at(-1)!.type).toBe('final');
        expect(events.filter(event => event.type === 'final')).toHaveLength(1);
        trainingPlanSchema.parse(events.at(-1)!.output.plan);
        expect(events.some(event => event.type === 'text')).toBe(true);
      } else {
        planApiResponseSchema.parse(r.body); expect(r.body.review.status).toBe('pass');
        expect(r.body.agentEvents.at(-1).type).toBe('final'); expect(r.body.memory.totalSessionsForUser).toBe(0);
      }
    });
    apiTest(`${path} real frontend chat payload is accepted`, async () => {
      const result = await withModelReplies([JSON.stringify(validPlan(3)), JSON.stringify(validPlan(3))], () => call(path, { token: alice.token, body: frontendChatRequest() }));
      status(result.value, 200);
      const output = path.endsWith('/stream') ? sse(result.value).at(-1)!.output : result.value.body;
      trainingPlanSchema.parse(output.plan); expect(output.plan.weeklyFrequency).toBe(3);
    });
    apiTest(`${path} provider rejection becomes JSON 500 or terminal SSE error`, async () => {
      const result = await withModelReplies([{ httpError: 400, message: 'synthetic provider failure' }], () => call(path, { token: alice.token, body: planRequest() }));
      expect(result.calls).toHaveLength(1);
      if (path.endsWith('/stream')) {
        const events = sse(result.value); expect(events.at(-1)!.type).toBe('error');
        expect(events.some(event => event.type === 'final')).toBe(false);
        expect(events.at(-1)!.summary).toContain('synthetic provider failure');
      } else { status(result.value, 500); expect(result.value.body.message).toContain('synthetic provider failure'); }
    });
    const invalid: Array<[string, () => unknown]> = [
      ['empty', () => ({})], ['null', () => null], ['array', () => []],
      ['missing user.id', () => ({ ...planRequest(), user: { trainingExperience: 'intermediate' } })],
      ['unknown goal', () => ({ ...planRequest(), goal: { primary: 'impossible' } })],
      ['zero days', () => ({ ...planRequest(), schedule: { availableDaysPerWeek: 0, sessionDurationMinutes: 60 } })],
      ['8 days', () => ({ ...planRequest(), schedule: { availableDaysPerWeek: 8, sessionDurationMinutes: 60 } })],
      ['fractional days', () => ({ ...planRequest(), schedule: { availableDaysPerWeek: 1.5, sessionDurationMinutes: 60 } })],
      ['short duration', () => ({ ...planRequest(), schedule: { availableDaysPerWeek: 1, sessionDurationMinutes: 19 } })],
      ['long duration', () => ({ ...planRequest(), schedule: { availableDaysPerWeek: 1, sessionDurationMinutes: 181 } })],
      ['age below minimum', () => ({ ...planRequest(), user: { ...planRequest().user, age: 11 } })],
      ['unknown experience', () => ({ ...planRequest(), user: { ...planRequest().user, trainingExperience: 'expert' } })],
      ['7 images', () => ({ ...planRequest(), inputImages: Array.from({ length: 7 }, () => ({ image: imageUrl })) })],
    ];
    for (const [name, payload] of invalid) apiTest(`${path} invalid payload: ${name}`, async () => {
      const result = await withModelReplies([], () => call(path, { token: alice.token, body: payload() }));
      status(result.value, 422); expect(result.calls).toHaveLength(0);
      expect(h.runtime.workoutMemoryStore.getSummary().totalStoredSessions).toBe(0);
    });
    apiTest(`${path} malformed JSON is 4xx`, async () => {
      clientError(await call(path, { token: alice.token, raw: '{broken' }));
    });
    apiTest(`${path} multipart JSON payload without images is accepted`, async () => {
      const form = new FormData(); form.set('payload', JSON.stringify(planRequest()));
      const result = await withModelReplies([JSON.stringify(validPlan())], () => call(path, { token: alice.token, body: form }));
      status(result.value, 200);
      const output = path.endsWith('/stream') ? sse(result.value).at(-1)!.output : result.value.body;
      trainingPlanSchema.parse(output.plan);
    });
    apiTest(`${path} malformed multipart payload must be 4xx`, async () => {
      const form = new FormData(); form.set('payload', '{broken');
      clientError(await call(path, { token: alice.token, body: form }));
    });
    apiTest(`${path} JSON camera data URL must reach successful final contract`, async () => {
      const body = { ...planRequest(), inputImages: [{ image: imageDataUrl }] };
      await withModelReplies([JSON.stringify(visionReply()), JSON.stringify(validPlan())], async () => {
        const r = await call(path, { token: alice.token, body }); status(r, 200);
        if (path.endsWith('/stream')) expect(sse(r).at(-1)!.type).toBe('final');
        else expect(r.body.imageContext.used).toBe(true);
      });
    });
    apiTest(`${path} multipart camera image must reach successful final contract`, async () => {
      const form = new FormData(); form.set('payload', JSON.stringify(planRequest()));
      form.append('inputImages', new File([Buffer.from(imageDataUrl.split(',')[1]!, 'base64')], 'camera.png', { type: 'image/png' }));
      await withModelReplies([JSON.stringify(visionReply()), JSON.stringify(validPlan())], async () => {
        const r = await call(path, { token: alice.token, body: form }); status(r, 200);
        if (path.endsWith('/stream')) expect(sse(r).at(-1)!.type).toBe('final');
        else expect(r.body.imageContext.used).toBe(true);
      });
    });
  }
  apiTest('plan forged user.id cannot write or retrieve another user memory', async () => {
    await h.runtime.workoutMemoryStore.storeSession(bob.user.id, { ...session(), sessionType: 'strength', intensity: 'medium', notes: 'BOB_PRIVATE_MARKER' });
    const request = planRequest(); request.user.id = bob.user.id;
    request.rememberedWorkouts = [{ ...session(), sessionType: 'strength', intensity: 'medium', sourceId: 'alice-plan' }];
    const result = await withModelReplies([JSON.stringify(validPlan())], () => call('/api/agent/plan', { token: alice.token, body: request }));
    status(result.value, 200); planApiResponseSchema.parse(result.value.body);
    expect(result.value.body.memory.totalSessionsForUser).toBe(1);
    expect(result.value.body.memory.retrievedSessions).toHaveLength(1);
    expect(JSON.stringify(result.value.body)).not.toContain('BOB_PRIVATE_MARKER');
    expect(JSON.stringify(result.calls)).not.toContain('BOB_PRIVATE_MARKER');
    expect(JSON.stringify(result.calls)).toContain(alice.user.id);
    expect((await h.runtime.workoutMemoryStore.listRecent(bob.user.id))[0]!.notes).toBe('BOB_PRIVATE_MARKER');
  });
  apiTest('plan tool-call and tool-result events use real recommendExercises', async () => {
    const result = await withModelReplies([recommendToolReply, JSON.stringify(validPlan())], () => call('/api/agent/plan/stream', { token: alice.token, body: planRequest() }));
    const events = sse(result.value);
    expect(result.calls).toHaveLength(2);
    expect(events.some(event => event.type === 'tool_call' && event.toolName === 'recommendExercises')).toBe(true);
    expect(events.some(event => event.type === 'tool_result' && event.toolName === 'recommendExercises')).toBe(true);
    expect(events.at(-1)!.type).toBe('final');
  });
  apiTest('dialog mode should not force an extra weekly-plan normalization', async () => {
    const body = { ...frontendChatRequest(), mode: 'dialog', goal: { ...frontendChatRequest().goal, requestNote: '卧推怎么做？' } };
    const result = await withModelReplies(['保持肩胛稳定，控制下放。', JSON.stringify(validPlan(3)), JSON.stringify(validPlan(3))], () => call('/api/agent/plan', { token: alice.token, body }));
    status(result.value, 200);
    planningDialogResponseSchema.parse(result.value.body);
    expect(result.value.body.answer).toBe('保持肩胛稳定，控制下放。');
    expect(result.value.body.agentEvents.at(-1).output.answer).toBe(result.value.body.answer);
    if (result.calls.length !== 1) throw new Error(`Dialog answer triggered ${result.calls.length} model requests; returned weekly plan: ${result.value.body.plan?.title}`);
  });
  apiTest('dialog stream preserves the answer and emits a terminal final event', async () => {
    const body = { ...frontendChatRequest(), mode: 'dialog', goal: { ...frontendChatRequest().goal, requestNote: '卧推怎么做？' } };
    const result = await withModelReplies(['保持肩胛稳定，控制下放。'], () =>
      call('/api/agent/plan/stream', { token: alice.token, body }));
    const events = sse(result.value);
    expect(result.calls).toHaveLength(1);
    expect(events.at(-1)!.type).toBe('final');
    expect(events.at(-1)!.output.mode).toBe('dialog');
    expect(events.at(-1)!.output.answer).toBe('保持肩胛稳定，控制下放。');
  });
});

describe('07 VLM and stream: real workflow with provider HTTP mock', () => {
  for (const path of ['/api/agent/vlm/analyze', '/api/agent/vlm/analyze/stream']) {
    apiTest(`${path} valid HTTPS image returns calorie frontend contract`, async () => {
      const body = { userId: bob.user.id, preferredTask: 'food_calorie_estimate', prompt: '请估算食物热量', images: [{ image: imageUrl, detail: 'low', purpose: 'food calorie estimate' }] };
      const result = await withModelReplies([JSON.stringify(visionReply())], () => call(path, { token: alice.token, body }));
      status(result.value, 200); expect(result.calls).toHaveLength(1); expect(result.imageDownloads).toBe(1);
      const output = path.endsWith('/stream') ? sse(result.value).at(-1)!.output : result.value.body;
      if (!path.endsWith('/stream')) vlmAnalyzeResponseSchema.parse(output);
      expect(output.task).toBe('food_calorie_estimate'); expect(output.results[0].foodAnalysis.totalCaloriesLow).toBe(100);
      expect(output.results[0].foodAnalysis.totalCaloriesHigh).toBe(150);
    });
    for (const [name, body] of [
      ['empty', {}], ['null', null], ['array', []], ['no images', { images: [] }],
      ['7 images', { images: Array.from({ length: 7 }, () => ({ image: imageUrl })) }],
      ['empty image', { images: [{ image: '' }] }], ['wrong image type', { images: [{ image: 42 }] }],
      ['invalid detail', { images: [{ image: imageUrl, detail: 'ultra' }] }],
      ['unknown task', { images: [{ image: imageUrl }], preferredTask: 'other' }],
      ['long prompt', { images: [{ image: imageUrl }], prompt: 'x'.repeat(2001) }],
    ] as const) apiTest(`${path} invalid payload: ${name}`, async () => {
      const result = await withModelReplies([], () => call(path, { token: alice.token, body }));
      status(result.value, 422); expect(result.calls).toHaveLength(0); expect(result.imageDownloads).toBe(0);
    });
    apiTest(`${path} malformed JSON is 4xx`, async () => {
      clientError(await call(path, { token: alice.token, raw: '{broken' }));
    });
    apiTest(`${path} provider rejection yields 500 or terminal SSE error`, async () => {
      const result = await withModelReplies([{ httpError: 400, message: 'synthetic vision failure' }], () => call(path, { token: alice.token, body: { images: [{ image: imageUrl }] } }));
      expect(result.calls).toHaveLength(1);
      if (path.endsWith('/stream')) {
        const events = sse(result.value); expect(events.at(-1)!.type).toBe('error');
        expect(events.some(event => event.type === 'final')).toBe(false);
      } else { status(result.value, 500); expect(result.value.body.message).toContain('synthetic vision failure'); }
    });
    apiTest(`${path} invalid model output yields 500 or terminal SSE error`, async () => {
      await withModelReplies(['not JSON'], async () => {
        const r = await call(path, { token: alice.token, body: { images: [{ image: imageUrl }] } });
        if (path.endsWith('/stream')) expect(sse(r).at(-1)!.type).toBe('error'); else status(r, 500);
      });
    });
    apiTest(`${path} authenticated camera data URL must succeed`, async () => {
      await withModelReplies([JSON.stringify(visionReply())], async () => {
        const r = await call(path, { token: alice.token, body: { images: [{ image: imageDataUrl, detail: 'low' }], preferredTask: 'food_calorie_estimate' } });
        status(r, 200); if (path.endsWith('/stream')) expect(sse(r).at(-1)!.type).toBe('final');
        else vlmAnalyzeResponseSchema.parse(r.body);
      });
    });
    apiTest(`${path} multipart camera upload must succeed`, async () => {
      const form = new FormData(); form.set('preferredTask', 'food_calorie_estimate');
      form.append('images', new File([Buffer.from(imageDataUrl.split(',')[1]!, 'base64')], 'camera.png', { type: 'image/png' }));
      await withModelReplies([JSON.stringify(visionReply())], async () => {
        const r = await call(path, { token: alice.token, body: form }); status(r, 200);
        if (path.endsWith('/stream')) expect(sse(r).at(-1)!.type).toBe('final'); else vlmAnalyzeResponseSchema.parse(r.body);
      });
    });
    for (const field of ['purposes', 'details']) apiTest(`${path} malformed multipart ${field} must be 4xx`, async () => {
      const form = new FormData(); form.set(field, '{broken');
      clientError(await call(path, { token: alice.token, body: form }));
    });
    apiTest(`${path} multipart without image is 422`, async () => {
      const form = new FormData(); form.set('prompt', '没有图片');
      status(await call(path, { token: alice.token, body: form }), 422);
    });
  }
  apiTest('frontend camera null-token request is rejected even after login', async () => {
    const r = await call('/api/agent/vlm/analyze', { token: null, body: { images: [{ image: imageDataUrl }], preferredTask: 'food_calorie_estimate' } });
    status(r, 401); expect(r.body).toEqual({ message: 'authorization token required' });
  });
  apiTest('frontend anonymous chat request is rejected', async () => {
    status(await call('/api/agent/plan', { token: null, body: frontendChatRequest() }), 401);
  });
});
