# ChatGym Mem0 OSS

Production uses `mem0ai@3.3.1` (`Memory` from `mem0ai/oss`) inside Bun with self-hosted Qdrant v1.18.0. Creation, extraction, semantic retrieval, updates and deletion go through the actual OSS SDK, with no hosted Mem0 API or legacy SQLite memory fallback. The original workout SQLite is preserved.

Verified official sources: [Node OSS quickstart](https://docs.mem0.ai/open-source/node-quickstart), [OpenAI LLM implementation](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/llms/openai.ts), [OpenAI embedder implementation](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/embeddings/openai.ts), [Memory implementation](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/memory/index.ts), [Qdrant implementation](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/vector_stores/qdrant.ts).

Both LLM and embedding implementations accept `config.baseURL`. OSS adds with `{userId, agentId, infer, metadata}`; search/list use `{filters:{user_id,agent_id},topK}`. The adapter verifies ownership before ID updates/deletes, reads back ADD/UPDATE events, ignores DELETE/NONE events, and sanitizes provider errors returned to API clients.

## Configuration and startup

Mem0 OSS runs inside the Bun backend and connects over HTTP to a native Qdrant v1.18.0 process. For Linux x86_64, install the [official release](https://github.com/qdrant/qdrant/releases/tag/v1.18.0) inside this project:

```bash
bun install --frozen-lockfile
mkdir -p .data/qdrant/bin
curl -fL --retry 2 https://github.com/qdrant/qdrant/releases/download/v1.18.0/qdrant-x86_64-unknown-linux-gnu.tar.gz -o /tmp/chatgym-qdrant-v1.18.0.tar.gz
tar -xzf /tmp/chatgym-qdrant-v1.18.0.tar.gz -C .data/qdrant/bin
```

The official [installation guide](https://qdrant.tech/documentation/installation/#from-source) also documents compilation from source for other environments. `QDRANT_BINARY` may override the executable path.

Merge `config/mem0.env.example` into the existing local `.env`, preserving provider settings and credentials. Configure:

```dotenv
MEM0_QDRANT_URL=http://127.0.0.1:26333
MEM0_QDRANT_PORT=26333
MEM0_LLM_MODEL=YOUR_SUPPORTED_CHAT_MODEL
MEM0_EMBEDDING_MODEL=YOUR_SUPPORTED_EMBEDDING_MODEL
MEM0_EMBEDDING_DIMS=YOUR_VERIFIED_VECTOR_LENGTH
```

`MEM0_LLM_API_KEY` falls back to `AI_PROVIDER_API_KEY`, `AI_GATEWAY_API_KEY`, then `OPENAI_API_KEY`. `MEM0_LLM_BASE_URL` falls back to `AI_PROVIDER_BASE_URL`, then `https://api.openai.com/v1`. Override `MEM0_EMBEDDING_API_KEY` and `MEM0_EMBEDDING_BASE_URL` for a separate embedding service; otherwise they reuse the extraction key/endpoint. Embedding model/dimension must be explicit. A chat model is required for extraction.

Verify the embedding endpoint and set dimensions to its measured vector length:

```bash
bun run mem0:verify-provider
```

The verification prints only model ID and numeric vector length. The example `BAAI/bge-m3` is a candidate; use a model supported by your provider. The current local `text-embedding-v4` endpoint was verified to return valid 1024-dimensional vectors.

In separate terminals, start the database and backend:

```bash
bun run qdrant:start
bun run start
```

`config/qdrant.local.yaml` binds to localhost on port 26333, disables telemetry, and persists data in `.data/qdrant/storage` with snapshots in `.data/qdrant/snapshots`. The starter forwards `MEM0_QDRANT_PORT` and a non-empty `MEM0_QDRANT_API_KEY`. Keep the database process running while using memory features; Ctrl+C stops it while retaining its data. The release executable alone does not include the web dashboard's static assets; the HTTP API remains available.

`MEM0_COLLECTION` defaults to `chatgym_memories_v1`. Changing embedding model/dimensions requires a new collection and re-embedding existing memories. Keep persistent `AUTH_DB_PATH` (default `.data/users.sqlite`) and JWT secret across restarts. User identity SQLite stores accounts/password hashes only. For deployment, keep Qdrant on a private network and expose the authenticated backend.

Configuration is resolved lazily. Missing config produces an actionable 503 only on memory access. Login, `/api/auth/me` and `/api/health` remain independent of Mem0/LLM/vectorstore startup.

To verify real providers against the running database:

```bash
bun run mem0:verify-memory
```

This makes model requests, writes synthetic facts into random test collections, and deletes those collections afterward. Real-provider verification passed write/read, semantic retrieval, update, LLM fact extraction and deletion with Bun 1.4.2, Mem0 3.3.1 and native Qdrant 1.18.0.

## Contracts, isolation and traceability

All memory endpoints use the JWT account ID; body/query `userId`, `id` and `metadata` cannot choose ownership:

- `POST /api/agent/memory/session`: existing workout `{sessions}` contract, deduplicated IDs/count.
- `GET /api/agent/memory/me`: existing chronological session/count contract.
- `POST /api/agent/memory/items`: `{memory:"exact text"}`; 201 `{status:"stored",item}`. Uses `infer:false`, preserving original content/whitespace.
- `GET /api/agent/memory/items?limit=20`: owned memory list.
- `GET /api/agent/memory/search?query=fitness%20preferences&limit=8`: owned semantic search.
- `PATCH /api/agent/memory/items/:id`: `{memory:"corrected text"}`.
- `DELETE /api/agent/memory/items/:id`: owned deletion; foreign/unknown ID returns 404.

Workout records use `agentId=chatgym_workout_v1` and `infer:false`. Chat/manual facts use `agentId=chatgym_conversation_v1`; automatic chat uses `infer:true`. Only user messages enter extraction; assistant suggestions are excluded. Planning writes actual `goal.requestNote` with `source=planning_chat` and request ID, and includes up to eight retrieved facts in dialog/plan/normalization/repair prompts. Workout retrieval and tool calls use authenticated identity and Mem0 similarity, with no old keyword scoring.

Qdrant metadata retains `kind`, `schemaVersion`, `source`, `sourceId`, exact `sourceInput`, timestamp, validated session fields, and migration provenance. User edits preserve original input and append durable `userEdits` containing previous content, exact edit input, UUID and timestamp. For workout edits, the compatible session notes preview remains within its 1000-character contract; full edit text remains in the memory and provenance.

Bun 1.4.2 cannot construct the SDK SQLite history's `better-sqlite3`. Configuration uses **Mem0's own** `historyStore.provider=memory`, with all personal facts/provenance persisted in Qdrant. SDK rolling extraction context and internal CRUD history are process-local. Deleted memories do not leave a durable deleted-memory audit; do not rely on this internal history for persistent audit requirements.

Health counters describe sessions observed by this process, reset on restart, and do not query Qdrant. `/memory/me` reads counts from Mem0. OSS 3.3.1 `getAll` has no cursor: session listing/counting supports up to 10000 sessions per user and explicitly fails beyond it, avoiding silent truncation. Ingestion is sequential/retryable, with durable fingerprint dedupe and a local per-user queue. Use one memory-writing backend instance; distributed writers need a shared lock for concurrent dedupe. Generic listing uses SDK order; session listing sorts chronologically.

## Backup, identity mapping and migration

The tool opens the original SQLite read-only and serializes a consistent backup, including committed WAL data. It checks integrity/checksum and stores a private manifest. Default mode creates backup/manifest only and makes no Mem0 calls. It never deletes or changes original rows.

Old Map-based auth IDs contain no usernames/password recovery information. Migration **cannot infer ownership**. First create/recover verified persistent accounts and obtain their stable IDs from authenticated account APIs. Provide a private map `{ "legacy-user-id": "stable-account-id" }`. Alternatively explicitly choose `--preserve-user-ids`: this is archival import under old IDs, inaccessible to new accounts with different IDs, not automatic reassociation.

```bash
# Dry run, using a local ownership map that must not be committed:
bun run mem0:migrate --source src/agent/data/workout-memory.sqlite \
  --backup .data/mem0-migration/backup-mapped.sqlite \
  --manifest .data/mem0-migration/manifest-mapped.json \
  --user-map .data/mem0-migration/user-map.json

# After reviewing the private manifest, import with the same paths/map:
bun run mem0:migrate --source src/agent/data/workout-memory.sqlite \
  --backup .data/mem0-migration/backup-mapped.sqlite \
  --manifest .data/mem0-migration/manifest-mapped.json \
  --user-map .data/mem0-migration/user-map.json --apply

# Repeat the same command to resume idempotently.
# Rollback only memories introduced by this manifest:
bun run mem0:migrate --rollback .data/mem0-migration/manifest-mapped.json
```

Replace `--user-map` with `--preserve-user-ids` only when deliberately preserving historical ownership. All rows/mappings are validated before remote writes. The manifest binds to source snapshot, mapping and collection; changing a mapping after dry run needs a new backup/manifest. Crash recovery reconciles fingerprints and migration IDs, including writes completed before checkpoint. Rollback excludes preexisting memories and refuses deletion if a user edited an imported memory. Backup/manifest/map must be kept private and backed up. Only one process may use a manifest; inspect recovery state before manually removing a stale `.lock` after a hard process kill.

Migration is optional and only needed when importing an existing SQLite memory store. A fresh setup can start with an empty Qdrant collection.

## Tests

```bash
bun run typecheck
bun test
bun run test:mem0
# Starts its own native Qdrant on an ephemeral port with temporary storage.
# Uses the real OSS SDK and local model fixtures; no provider credentials needed.
# Restarts the database process and checks persisted data before cleaning up.
bun run test:mem0:integration
```

`bun run test:mem0:native` is an alias for the same integration test. `MEM0_TEST_QDRANT_BINARY` (or `QDRANT_BINARY`) may select a different executable; the default is `.data/qdrant/bin/qdrant`.

Regular fixtures inject `tests/helpers/fake-mem0-adapter.ts`; production never imports it. Facade tests cover scopes/events/readback/errors. Native integration verifies semantic synonyms, extraction, isolation, CRUD, actual process restart persistence and durable deduplication (20 assertions). It stops its own database before removing temporary storage. Migration tests cover snapshots, mappings, checksums, dry run, repeated imports, interrupted writes and rollback protections. Existing API/JWT/planning/image contracts execute without real provider secrets.
