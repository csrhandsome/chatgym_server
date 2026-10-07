import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Mem0OssAdapter, MemoryNotFoundError, resolveMem0Config } from '../src/agent/shared/mem0-adapter';
import { WorkoutMemoryStore } from '../src/agent/shared/workout-memory-store';

const integration = process.env.RUN_MEM0_INTEGRATION === '1' ? test : test.skip;

integration('real Mem0 OSS + persistent Qdrant: isolation, semantic retrieval, chat extraction, update/delete and restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chatgym-mem0-sdk-'));
  const collection = `chatgym_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const nativeBinary = process.env.MEM0_TEST_QDRANT_BINARY || process.env.QDRANT_BINARY || '.data/qdrant/bin/qdrant';
  // Native mode owns a separate process, random port and disposable storage.
  const portProbe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const nativePort = portProbe.port;
  portProbe.stop(true);
  const qdrantUrl = `http://127.0.0.1:${nativePort}`;
  let qdrant: ReturnType<typeof Bun.spawn> | undefined;
  const waitReady = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (qdrant && qdrant.exitCode !== null) throw new Error(`Native Qdrant exited with code ${qdrant.exitCode}.`);
      try { if ((await fetch(`${qdrantUrl}/readyz`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await Bun.sleep(100);
    }
    throw new Error('Qdrant did not become ready.');
  };
  const startNative = async () => {
    qdrant = Bun.spawn([resolve(nativeBinary), '--config-path', new URL('../config/qdrant.local.yaml', import.meta.url).pathname], {
      cwd: directory,
      env: {
        QDRANT__SERVICE__HTTP_PORT: String(nativePort),
        QDRANT__STORAGE__STORAGE_PATH: join(directory, 'qdrant-storage'),
        QDRANT__STORAGE__SNAPSHOTS_PATH: join(directory, 'qdrant-snapshots'),
      },
      stdout: 'ignore', stderr: 'inherit',
    });
    await waitReady();
  };
  const stopNative = async () => {
    if (!qdrant) return;
    qdrant.kill('SIGTERM');
    const timer = setTimeout(() => qdrant?.kill('SIGKILL'), 5000);
    try { await qdrant.exited; } finally { clearTimeout(timer); }
    qdrant = undefined;
  };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = await request.json() as Record<string, unknown>;
    calls.push({ path, body });
    if (path === '/embedding/v1/embeddings') {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({ object: 'list', model: 'mock-embedding', data: inputs.map((input, index) => {
        const text = String(input).toLowerCase();
        // Synonyms share a vector, demonstrating semantic retrieval through Mem0/Qdrant.
        const embedding = /chest|pectoral|卧推/.test(text) ? [1, 0.01, 0.01] : /cardio|running|aerobic/.test(text) ? [0.01, 1, 0.01] : [0.01, 0.01, 1];
        return { object: 'embedding', index, embedding };
      }), usage: { prompt_tokens: 1, total_tokens: 1 } });
    }
    if (path === '/llm/v1/chat/completions') {
      return Response.json({ id: 'mock-completion', object: 'chat.completion', created: 1, model: 'mock-llm',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ memory: [{ text: 'User prefers morning pectoral workouts.' }] }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    return new Response('Unexpected provider endpoint', { status: 404 });
  } });
  const oldDataDir = process.env.MEM0_DATA_DIR;
  process.env.MEM0_DATA_DIR = directory;
  const config = resolveMem0Config({ MEM0_LLM_API_KEY: 'local-mock-key', MEM0_LLM_BASE_URL: `${server.url}llm/v1`, MEM0_LLM_MODEL: 'mock-llm',
    MEM0_EMBEDDING_API_KEY: 'local-mock-key', MEM0_EMBEDDING_BASE_URL: `${server.url}embedding/v1`, MEM0_EMBEDDING_MODEL: 'mock-embedding',
    MEM0_EMBEDDING_DIMS: '3', MEM0_QDRANT_URL: qdrantUrl, MEM0_COLLECTION: collection, MEM0_DATA_DIR: directory });
  try {
    await startNative();
    const store = new WorkoutMemoryStore(new Mem0OssAdapter(config));
    const base = { completedAt: '2026-10-01T10:00:00.000Z', sessionType: 'strength' as const, durationMinutes: 60,
      muscleGroups: ['胸'], intensity: 'medium' as const };
    const chestId = await store.storeSession('alice', { ...base, sourceId: 'chest', exerciseNames: ['chest press'] });
    await store.storeSession('alice', { ...base, sourceId: 'cardio', exerciseNames: ['running cardio'] });
    const bobId = await store.storeSession('bob', { ...base, sourceId: 'bob', exerciseNames: ['BOB_PRIVATE_MARKER chest press'] });
    const hits = await store.searchRelevant('alice', { query: 'pectoral', limit: 2 });
    expect(hits[0]!.id).toBe(chestId); expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits.some(item => item.id === bobId)).toBe(false);
    await expect(store.deleteMemory('bob', chestId)).rejects.toBeInstanceOf(MemoryNotFoundError);
    await expect(store.updateMemory('bob', chestId, 'forged')).rejects.toBeInstanceOf(MemoryNotFoundError);
    const facts = await store.rememberConversation('alice', [{ role: 'user', content: 'I prefer morning chest workouts.' },
      { role: 'assistant', content: 'You must run 10 km daily.' }], { sourceId: 'request-1', source: 'planning_chat' });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metadata.sourceInput).toEqual([{ role: 'user', content: 'I prefer morning chest workouts.' }]);
    expect(await store.searchMemories('bob', 'morning')).toEqual([]);
    expect((await store.searchMemories('alice', 'pectoral'))[0]!.id).toBe(facts[0]!.id);
    await store.updateMemory('alice', facts[0]!.id, 'User prefers evening pectoral workouts.');
    await stopNative();
    await startNative();
    console.log('Native Qdrant process restarted; verifying persisted Mem0 data.');
    const restarted = new WorkoutMemoryStore(new Mem0OssAdapter(config));
    expect(await restarted.getUserSessionCount('alice')).toBe(2);
    const restoredFact = (await restarted.searchMemories('alice', 'pectoral'))[0]!;
    expect(restoredFact.memory).toContain('evening');
    expect(restoredFact.metadata.sourceInput).toEqual([{ role: 'user', content: 'I prefer morning chest workouts.' }]);
    expect(restoredFact.metadata.userEdits).toBeArrayOfSize(1);
    expect(await restarted.storeSession('alice', { ...base, sourceId: 'chest', exerciseNames: ['chest press'] })).toBe(chestId);
    await restarted.deleteMemory('alice', chestId);
    expect(await restarted.getUserSessionCount('alice')).toBe(1);
    await restarted.deleteMemory('alice', facts[0]!.id);
    expect(await restarted.searchMemories('alice', 'morning')).toEqual([]);
    expect(await restarted.getUserSessionCount('bob')).toBe(1);
    expect(calls.some(call => call.path === '/embedding/v1/embeddings')).toBe(true);
    expect(calls.some(call => call.path === '/llm/v1/chat/completions')).toBe(true);
    expect(calls.filter(call => call.path.includes('embeddings')).every(call => call.body.model === 'mock-embedding')).toBe(true);
  } finally {
    server.stop(true);
    if (oldDataDir === undefined) delete process.env.MEM0_DATA_DIR; else process.env.MEM0_DATA_DIR = oldDataDir;
    try {
      await stopNative();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}, 60_000);
