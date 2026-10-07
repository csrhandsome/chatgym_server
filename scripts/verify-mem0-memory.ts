import { Mem0OssAdapter, resolveMem0Config } from '../src/agent/shared/mem0-adapter';

// Uses configured real providers; all writes go to disposable test collections.
const collection = `chatgym_test_${crypto.randomUUID().replaceAll('-', '')}`;
const config = resolveMem0Config({ ...process.env, MEM0_COLLECTION: collection });
const memory = new Mem0OssAdapter(config);
const user = 'native-smoke-test';
let failed = false;
try {
  const [item] = await memory.add(user, [{ role: 'user', content: 'I prefer evening chest workouts.' }], {
    scope: 'conversation', infer: false, metadata: { source: 'native_qdrant_verification' },
  });
  if (!item || (await memory.get(user, item.id)).memory !== item.memory) throw new Error();
  console.log('PASS real embedding + Mem0 write/read');
  if (!(await memory.search(user, 'What time do I prefer to train my chest?')).some(hit => hit.id === item.id)) throw new Error();
  console.log('PASS real embedding + semantic retrieval');
  await memory.update(user, item.id, 'I prefer morning chest workouts.');
  if (!(await memory.get(user, item.id)).memory.includes('morning')) throw new Error();
  console.log('PASS memory update');
  const facts = await memory.add(user, [{ role: 'user', content: 'My fitness goal is to gain muscle. I train three times every week.' }], {
    scope: 'conversation', infer: true, metadata: { source: 'native_qdrant_verification' },
  });
  if (!facts.length) throw new Error();
  console.log('PASS real LLM memory extraction and persisted readback');
  await memory.delete(user, item.id);
  if ((await memory.list(user)).some(hit => hit.id === item.id)) throw new Error();
  console.log('PASS memory deletion');
} catch {
  // SDK errors can contain request credentials. Never dump them.
  console.error('Memory verification failed; check the last passed stage and local provider configuration.');
  failed = true;
} finally {
  const store = config.vectorStore!.config;
  for (const name of [collection, `${collection}_entities`]) {
    try {
      const response = await fetch(`${String(store.url).replace(/\/$/, '')}/collections/${name}`, {
        method: 'DELETE', headers: store.apiKey ? { 'api-key': store.apiKey } : {}, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok && response.status !== 404) throw new Error();
    } catch {
      console.error(`Could not clean up test collection ${name}.`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
