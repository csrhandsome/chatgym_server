import { expect, test } from 'bun:test';
import type { Memory } from 'mem0ai/oss';
import { Mem0OssAdapter, MemoryNotFoundError, MemoryUnavailableError, resolveMem0Config } from '../src/agent/shared/mem0-adapter';

const payload = (id = 'memory-a', owner = 'alice') => ({ id, memory: 'morning workouts', user_id: owner,
  agent_id: 'chatgym_conversation_v1', metadata: { sourceId: 'request-1', sourceInput: 'I prefer mornings.' } });
const adapterWithSdk = (sdk: Record<string, unknown>) => new Mem0OssAdapter({ disableHistory: true }, async () => sdk as unknown as Memory);

test('configuration is explicit, independent, and supports both OpenAI-compatible base URLs', () => {
  const config = resolveMem0Config({ AI_PROVIDER_API_KEY: 'not-a-secret-test-key', AI_PROVIDER_BASE_URL: 'http://llm.invalid/v1',
    MEM0_EMBEDDING_API_KEY: 'embedding-test-key', MEM0_EMBEDDING_BASE_URL: 'http://embedding.invalid/v1',
    MEM0_EMBEDDING_MODEL: 'embedding-model', MEM0_EMBEDDING_DIMS: '3', MEM0_QDRANT_URL: 'http://qdrant.invalid:6333' });
  expect(config.llm!.config.baseURL).toBe('http://llm.invalid/v1');
  expect(config.embedder!.config.baseURL).toBe('http://embedding.invalid/v1');
  expect(config.embedder!.config.apiKey).toBe('embedding-test-key');
  expect(config.embedder!.config.embeddingDims).toBeUndefined();
  expect(config.vectorStore!.config.dimension).toBe(3);
  expect(() => resolveMem0Config({})).toThrow('MEM0_EMBEDDING_MODEL');
  expect(() => resolveMem0Config({ AI_PROVIDER_API_KEY: 'never-print-this', MEM0_EMBEDDING_MODEL: 'm', MEM0_QDRANT_URL: 'http://localhost' })).toThrow('MEM0_EMBEDDING_DIMS');
});

test('lazy construction and health require no model or vector-store connection', () => {
  let calls = 0;
  adapterWithSdk({ getAll: async () => { calls++; } });
  expect(calls).toBe(0);
});

test('injected SDK facade does not mutate production environment on first access', async () => {
  const before = { dir: process.env.MEM0_DIR, telemetry: process.env.MEM0_TELEMETRY };
  const adapter = adapterWithSdk({ get: async () => payload() });
  await adapter.get('alice', 'memory-a');
  expect(process.env.MEM0_DIR).toBe(before.dir);
  expect(process.env.MEM0_TELEMETRY).toBe(before.telemetry);
});

test('ADD/UPDATE events are read back; DELETE/NONE do not cause false write failures', async () => {
  const gets: string[] = [];
  const adapter = adapterWithSdk({
    add: async () => ({ results: [
      { id: 'added', metadata: { event: 'ADD' } }, { id: 'updated', event: 'UPDATE' },
      { id: 'deleted', metadata: { event: 'DELETE' } }, { id: 'ignored', metadata: { event: 'NONE' } },
    ] }),
    get: async (id: string) => { gets.push(id); if (['deleted', 'ignored'].includes(id)) return null; return payload(id); },
  });
  const items = await adapter.add('alice', [{ role: 'user', content: 'updated preference' }], { scope: 'conversation', infer: true, metadata: {} });
  expect(items.map(item => item.id)).toEqual(['added', 'updated']);
  expect(gets).toEqual(['added', 'updated']);
});

test('scope filters override forged identity and foreign ownership prevents mutation', async () => {
  let filters: Record<string, unknown> = {}, mutations = 0;
  const adapter = adapterWithSdk({
    search: async (_query: string, config: { filters: Record<string, unknown> }) => { filters = config.filters; return { results: [payload()] }; },
    get: async () => payload('foreign', 'bob'), update: async () => { mutations++; }, delete: async () => { mutations++; },
  });
  await adapter.search('alice', 'fitness', { scope: 'conversation', metadata: { user_id: 'bob', agent_id: 'evil' }, limit: 8 });
  expect(filters).toEqual({ user_id: 'alice', agent_id: 'chatgym_conversation_v1' });
  await expect(adapter.update('alice', 'foreign', 'change')).rejects.toBeInstanceOf(MemoryNotFoundError);
  await expect(adapter.delete('alice', 'foreign')).rejects.toBeInstanceOf(MemoryNotFoundError);
  expect(mutations).toBe(0);
});

test('partial write/readback and remote failures report actionable errors without secrets', async () => {
  const adapter = adapterWithSdk({ add: async () => ({ results: [{ id: 'lost' }] }), get: async () => null });
  await expect(adapter.add('alice', [{ role: 'user', content: 'test' }], { scope: 'workout', infer: false, metadata: {} })).rejects.toBeInstanceOf(MemoryUnavailableError);
  const failed = adapterWithSdk({ search: async () => { throw new Error('Authorization: Bearer never-expose-test'); } });
  try { await failed.search('alice', 'test'); throw new Error('expected failure'); }
  catch (error) { expect(String(error)).not.toContain('never-expose-test'); expect(error).toBeInstanceOf(MemoryUnavailableError); }
});
