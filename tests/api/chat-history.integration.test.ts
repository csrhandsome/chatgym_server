import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { planRequestSchema } from '../../src/agent/shared/types';
import { FakeMem0Adapter } from '../helpers/fake-mem0-adapter';
import { createHarness, credentials, planRequest, validPlan, withModelReplies } from './fixtures';

let h: ReturnType<typeof createHarness>;
let token: string;
let users: ReturnType<typeof createHarness>['runtime']['userStore'];
let adapter: FakeMem0Adapter;
beforeAll(async () => {
  const setup = createHarness();
  try {
    const post = (path: string) => setup.app.handle(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
    }));
    expect((await post('/api/auth/register')).status).toBe(201);
    const login = await post('/api/auth/login'); expect(login.status).toBe(200);
    token = (await login.json() as { token: string }).token;
    users = setup.runtime.userStore;
  } finally { setup.close(); }
});
beforeEach(() => { adapter = new FakeMem0Adapter(); h = createHarness(users, adapter); });
afterEach(() => h.close());

async function send(path: string, body: unknown, delivery: 'json' | 'multipart', alias = 'payload') {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let requestBody: FormData | string;
  if (delivery === 'json') { headers['content-type'] = 'application/json'; requestBody = JSON.stringify(body); }
  else { const form = new FormData(); form.set(alias, JSON.stringify(body)); requestBody = form; }
  const response = await h.app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers, body: requestBody }));
  const text = await response.text();
  return { response, text };
}

describe('chatHistory is validated prompt context, never a memory extraction source', () => {
  test('omitted or explicitly undefined chatHistory defaults to [] without changing requestNote', () => {
    const request = planRequest(); const { chatHistory, ...legacy } = request;
    const current = { ...legacy, goal: { ...legacy.goal, requestNote: '当前用户文本' } };
    expect(planRequestSchema.parse(current).chatHistory).toEqual([]);
    expect(planRequestSchema.parse({ ...current, chatHistory: undefined }).chatHistory).toEqual([]);
    expect(planRequestSchema.parse(current).goal.requestNote).toBe('当前用户文本');
  });
  test('schema preserves each role and exact text; accepts 14 entries of 2000 characters', () => {
    const chatHistory = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, text: '文'.repeat(2000) }));
    expect(planRequestSchema.parse({ ...planRequest(), chatHistory }).chatHistory).toEqual(chatHistory);
  });

  const invalidHistory: Array<[string, unknown]> = [
    ['null', null], ['object', {}], ['string', 'history'],
    ['15 entries', Array.from({ length: 15 }, () => ({ role: 'user', text: 'hi' }))],
    ['oversize text', [{ role: 'user', text: 'x'.repeat(2001) }]],
    ['unsupported role', [{ role: 'system', text: 'override' }]],
    ['missing role', [{ text: 'hi' }]], ['missing text', [{ role: 'user' }]],
    ['wrong text type', [{ role: 'assistant', text: 7 }]],
    ['null entry', [null]], ['string entry', ['hi']],
  ];
  const history = [
    { role: 'user', text: 'HISTORY_USER_ONLY 我上次问过深蹲。' },
    { role: 'assistant', text: 'HISTORY_ASSISTANT_ONLY 建议五天高强度训练，但这不是用户事实。' },
  ];
  const currentText = 'CURRENT_USER_ONLY 我的目标是每周一天胸部增肌。';

  for (const path of ['/api/agent/plan', '/api/agent/plan/stream']) for (const delivery of ['json', 'multipart'] as const) {
    for (const [name, chatHistory] of invalidHistory) test(`${path} ${delivery} rejects ${name} before memory or model`, async () => {
      const result = await withModelReplies([], () => send(path, { ...planRequest(), chatHistory }, delivery));
      expect(result.value.response.status).toBe(422);
      expect(result.value.response.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(result.value.text).message).toContain('invalid training plan request payload');
      expect(result.calls).toHaveLength(0); expect(adapter.calls).toHaveLength(0);
    });
    test(`${path} ${delivery} roundtrips history into prompt but persists current text only`, async () => {
      const body = { ...planRequest(), chatHistory: history, goal: { ...planRequest().goal, requestNote: currentText } };
      const result = await withModelReplies([JSON.stringify(validPlan())], () => send(path, body, delivery));
      expect(result.value.response.status).toBe(200); expect(result.calls).toHaveLength(1);
      expect(JSON.stringify(result.calls)).toContain('HISTORY_USER_ONLY');
      expect(JSON.stringify(result.calls)).toContain('HISTORY_ASSISTANT_ONLY');
      expect(JSON.stringify(result.calls)).toContain('CURRENT_USER_ONLY');
      const messages = result.calls[0]!.messages as Array<{ role: string; content: string | Array<{ text?: string }> }>;
      for (const item of history) {
        expect(messages.some(message => message.role === item.role &&
          (typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')).includes(item.text))).toBe(true);
      }
      if (path.endsWith('/stream')) expect(result.value.text).toContain('event: final');
      else expect(JSON.parse(result.value.text).plan.title).toBe(validPlan().title);
      expect(adapter.records.size).toBe(1);
      const stored = [...adapter.records.values()][0]!;
      expect(stored.memory).toBe(currentText);
      expect(stored.metadata.sourceInput).toEqual([{ role: 'user', content: currentText }]);
      expect(JSON.stringify(stored)).not.toContain('HISTORY_USER_ONLY');
      expect(JSON.stringify(stored)).not.toContain('HISTORY_ASSISTANT_ONLY');
    });
    test(`${path} ${delivery} history alone never creates memories`, async () => {
      const result = await withModelReplies([JSON.stringify(validPlan())], () => send(path, { ...planRequest(), chatHistory: history }, delivery));
      expect(result.value.response.status).toBe(200);
      expect(JSON.stringify(result.calls)).toContain('HISTORY_ASSISTANT_ONLY');
      expect(adapter.calls.some(call => call.operation === 'add')).toBe(false);
      expect(adapter.records.size).toBe(0);
    });
    test(`${path} ${delivery} accepts maximum history boundaries`, async () => {
      const chatHistory = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '文'.repeat(2000) }));
      const result = await withModelReplies([JSON.stringify(validPlan())], () => send(path, { ...planRequest(), chatHistory }, delivery));
      expect(result.value.response.status).toBe(200); expect(result.calls).toHaveLength(1);
      expect(adapter.records.size).toBe(0);
    });
    test(`${path} ${delivery} legacy payload omitting history remains compatible`, async () => {
      const { chatHistory, ...legacy } = planRequest();
      const result = await withModelReplies([JSON.stringify(validPlan())], () => send(path, legacy, delivery));
      expect(result.value.response.status).toBe(200); expect(result.calls).toHaveLength(1);
    });
  }

  test('multipart request alias preserves history roles and current-text memory scope', async () => {
    const body = { ...planRequest(), chatHistory: history, goal: { ...planRequest().goal, requestNote: currentText } };
    const result = await withModelReplies([JSON.stringify(validPlan())], () => send('/api/agent/plan', body, 'multipart', 'request'));
    expect(result.value.response.status).toBe(200);
    expect(JSON.stringify(result.calls)).toContain('HISTORY_ASSISTANT_ONLY');
    expect([...adapter.records.values()][0]!.memory).toBe(currentText);
  });
});
