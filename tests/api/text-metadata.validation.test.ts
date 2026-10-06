import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHarness, credentials } from './fixtures';

let harness: ReturnType<typeof createHarness>;
let users: ReturnType<typeof createHarness>['runtime']['userStore'];
let token: string;

beforeAll(async () => {
  const setup = createHarness();
  try {
    const response = await setup.app.handle(new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    }));
    expect(response.status).toBe(201);
    token = (await response.json() as { token: string }).token;
    users = setup.runtime.userStore;
  } finally {
    setup.close();
  }
});

beforeEach(() => { harness = createHarness(users); });
afterEach(() => { harness.close(); });

function request(path: string, body?: unknown) {
  return harness.app.handle(new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe('text metadata validates raw JSON before normalization', () => {
  for (const [name, metadata] of [
    ['empty array', []],
    ['string array', ['frontend']],
    ['number array', [1]],
    ['object array', [{ source: 'frontend' }]],
    ['nested array', [[1, 2]]],
    ['null', null],
    ['string', 'frontend'],
    ['number', 42],
    ['boolean', true],
  ] as const) {
    test(`rejects ${name} with JSON 422 and stores no record`, async () => {
      const response = await request('/api/text', { text: 'metadata validation', metadata });
      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ message: 'metadata must be an object' });
      expect(harness.runtime.textStore.getSummary().totalReceived).toBe(0);
      const listed = await request('/api/text');
      expect(await listed.json()).toEqual({ items: [], count: 0 });
    });
  }

  for (const [name, metadata] of [
    ['omitted metadata', undefined],
    ['empty object', {}],
    ['object with nested arbitrary JSON', { count: 1, label: '你好', nested: ['ok', { value: null }], enabled: true }],
    ['object with numeric keys', { 0: 'first', 1: 'second' }],
  ] as const) {
    test(`accepts ${name} and preserves it on retrieval`, async () => {
      const response = await request('/api/text', { text: 'metadata validation', metadata });
      expect(response.status).toBe(201);
      const accepted = await response.json() as {
        status: string;
        record: { id: string; metadata?: unknown; source: string };
      };
      expect(accepted.status).toBe('accepted');
      expect(accepted.record.source).toBe('api');
      expect(accepted.record.metadata).toEqual(metadata);
      const retrieved = await request(`/api/text/${accepted.record.id}`);
      expect(retrieved.status).toBe(200);
      expect(await retrieved.json()).toEqual({ record: accepted.record });
      expect(harness.runtime.textStore.getSummary().totalReceived).toBe(1);
    });
  }
});
