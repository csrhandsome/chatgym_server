# chatgym_server

To install dependencies:

```bash
bun install
```

To run in development:

```bash
bun run dev
```

To run once:

```bash
bun run start
```

To type-check:

```bash
bun run typecheck
```

## API

- `GET /` service entry and route summary
- `POST /api/auth/register` register a user and receive a JWT token
- `POST /api/auth/login` log in and receive a JWT token
- `GET /api/auth/me` read the current user from `Authorization: Bearer <token>`
- `GET /api/health` server health, uptime, text summary, websocket connection count
- `POST /api/text` receive text from frontend, requires Bearer token
- `GET /api/text` list recent text payloads for the current user
- `GET /api/text/:id` get one text payload for the current user
- `POST /api/agent/vlm/analyze` authenticated image analysis
- `POST /api/agent/vlm/analyze/stream` authenticated SSE stream for image analysis
- `POST /api/agent/plan` authenticated training plan generation
- `POST /api/agent/plan/stream` authenticated SSE stream for plan generation
- `POST /api/agent/memory/session` authenticated memory ingestion
- `GET /api/agent/memory/me` authenticated workout memory list

## Auth

Set `JWT_SECRET` in your environment for production. The service uses:

- `@elysiajs/jwt` for token signing and verification
- `Bun.password.hash()` / `Bun.password.verify()` for password hashing and login checks

### `POST /api/auth/register`

```json
{
  "username": "demo_user",
  "password": "strongpass123"
}
```

### `POST /api/auth/login`

```json
{
  "username": "demo_user",
  "password": "strongpass123"
}
```

### Authenticated `POST /api/text`

```json
{
  "text": "hello from frontend",
  "source": "web-client",
  "sessionId": "room-1",
  "metadata": {
    "page": "chat"
  }
}
```

Request header:

```text
Authorization: Bearer <token>
```

## Agent Streaming

Both stream endpoints return `text/event-stream` and emit typed events:

- `thinking`
- `tool_call`
- `tool_result`
- `text`
- `final`
- `error`

Recommended endpoints:

- `POST /api/agent/vlm/analyze/stream`
- `POST /api/agent/plan/stream`

The frontend should call them with `fetch()` and read the response body as an SSE stream.

## Multipart Image Upload

`/api/agent/vlm/analyze` and `/api/agent/vlm/analyze/stream` now support `multipart/form-data`.

Form fields:

- `images`: repeatable file field
- `prompt`: optional string
- `preferredTask`: optional string
- `purposes`: optional JSON string array matching image order
- `details`: optional JSON string array matching image order, values: `auto`, `low`, `high`

Example fields:

```text
images=<file 1>
images=<file 2>
prompt=analyze available equipment
preferredTask=training_plan_context
purposes=["front view","machine close-up"]
details=["auto","high"]
```

`/api/agent/plan` and `/api/agent/plan/stream` also accept `multipart/form-data` with:

- `payload`: JSON string for the normal planning request body
- `inputImages`: repeatable file field
- `inputImagePurposes`: optional JSON string array
- `inputImageDetails`: optional JSON string array

## WebSocket

- `ws://localhost:3000/ws/text`

Supported client messages:

- `ping`
- `{"type":"ping"}`

The websocket is read-only now. It pushes connection acknowledgements and server stats updates, while authenticated text ingestion goes through `POST /api/text`.
