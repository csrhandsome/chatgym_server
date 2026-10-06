// Emits model IDs and dimensions only; never provider responses or credentials.
const baseURL = process.env.MEM0_EMBEDDING_BASE_URL || process.env.MEM0_LLM_BASE_URL || process.env.AI_PROVIDER_BASE_URL;
const apiKey = process.env.MEM0_EMBEDDING_API_KEY || process.env.MEM0_LLM_API_KEY || process.env.AI_PROVIDER_API_KEY;
const model = process.env.MEM0_EMBEDDING_MODEL || 'BAAI/bge-m3';
if (!baseURL || !apiKey) {
  console.error('Set MEM0_EMBEDDING_BASE_URL/API_KEY or AI_PROVIDER_BASE_URL/API_KEY.');
  process.exit(1);
}
try {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: 'ChatGym embedding dimension verification', encoding_format: 'float' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}. Verify the embedding model ID and endpoint.`);
  const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const vector = data.data?.[0]?.embedding;
  if (!vector?.length || !vector.every(Number.isFinite)) throw new Error('Embedding provider returned no valid numeric vector.');
  console.log(JSON.stringify({ model, dimensions: vector.length, valid: true }));
} catch (error) {
  // Do not dump SDK/HTTP errors: their objects can include credentials.
  console.error(error instanceof Error && /^(Embedding provider)/.test(error.message) ? error.message : 'Embedding verification failed. Check provider connectivity and local credentials.');
  process.exit(1);
}
