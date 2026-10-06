import { Elysia, t } from 'elysia';
import { generatePlanningResponse } from '../agent/planning/workflows/generate-training-plan';
import {
  memoryAppendRequestSchema,
  type PlanImageInput,
  planRequestSchema,
  type PlanRequestInput,
  type VlmAnalyzeRequest,
  vlmAnalyzeRequestSchema,
} from '../agent/shared/types';
import { analyzeFitnessImages } from '../agent/vlm/workflows/analyze-fitness-images';
import { MemoryNotFoundError, MemoryUnavailableError } from '../agent/shared/workout-memory-store';
import { createAuthContext, resolveAuthenticatedUser } from '../plugins/auth';
import type { ServerRuntime } from '../runtime';
import { createAgentSseResponse } from './sse';

const errorResponseSchema = t.Object({
  message: t.String(),
  issues: t.Optional(t.Any()),
});

const memoryResponseSchema = t.Object({
  status: t.Literal('stored'),
  storedIds: t.Array(t.String()),
  totalSessionsForUser: t.Number({ minimum: 0 }),
});

const storedMemorySchema = t.Object({
  id: t.String(),
  memory: t.String(),
  userId: t.String(),
  metadata: t.Record(t.String(), t.Unknown()),
  score: t.Optional(t.Number()),
  createdAt: t.Optional(t.String()),
  updatedAt: t.Optional(t.String()),
});

const memoryListResponseSchema = t.Object({ items: t.Array(storedMemorySchema) });
const memoryIdParamsSchema = t.Object({ id: t.String({ minLength: 1, maxLength: 120 }) });
const memoryTextBodySchema = t.Object({ memory: t.String({ minLength: 1, maxLength: 10000 }) });
const memoryLimitSchema = t.Optional(t.String());
const parseMemoryLimit = (raw?: string) => {
  if (raw === undefined) return 10;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit <= 50 ? limit : null;
};

const isMultipartRequest = (contentType?: string) =>
  contentType?.toLowerCase().includes('multipart/form-data') ?? false;

const invalidJsonPayload = Symbol('invalid-json-payload');
type MultipartFormData = {
  get(name: string): string | File | null;
  getAll(name: string): Array<string | File>;
};

const parseJsonRequest = async (request: Request) => {
  try {
    return (await request.json()) as unknown;
  } catch {
    return invalidJsonPayload;
  }
};

const parseAgentRequest = async (request: Request, parseMultipart: () => Promise<unknown>) => {
  try {
    return isMultipartRequest(request.headers.get('content-type') ?? undefined)
      ? await parseMultipart()
      : await parseJsonRequest(request);
  } catch {
    return invalidJsonPayload;
  }
};

const getFormString = (form: MultipartFormData, key: string) => {
  const value = form.get(key);

  if (value !== null && typeof value !== 'string') {
    throw new Error(`${key} must be a text field`);
  }

  return typeof value === 'string' ? value : undefined;
};

const parseJsonField = <T>(raw: string | undefined): T | undefined => {
  if (raw === undefined) {
    return undefined;
  }

  return JSON.parse(raw) as T;
};

const parseImagePurposes = (raw: string | undefined) => {
  const value = parseJsonField<unknown>(raw);
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 200)) {
    throw new Error('image purposes must be an array of strings');
  }
  return value as string[];
};

const parseImageDetails = (raw: string | undefined) => {
  const value = parseJsonField<unknown>(raw);
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !['auto', 'low', 'high'].includes(item))) {
    throw new Error('image details must be an array of auto, low or high');
  }
  return value as Array<'auto' | 'low' | 'high'>;
};

const collectFiles = (form: MultipartFormData, keys: string[]) =>
  keys.flatMap((key) => form.getAll(key)).filter((value): value is File => value instanceof File);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
};

const fileToDataUrl = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
};

const buildImageInputsFromFiles = async ({
  files,
  purposes,
  details,
}: {
  files: File[];
  purposes?: string[];
  details?: Array<'auto' | 'low' | 'high'>;
}): Promise<PlanImageInput[]> =>
  Promise.all(
    files.map(async (file, index) => ({
      image: await fileToDataUrl(file),
      purpose: purposes?.[index],
      detail: details?.[index] ?? 'auto',
    })),
  );

const parseMultipartVlmRequest = async (request: Request, userId: string) => {
  const form = await request.formData();
  const files = collectFiles(form, ['images']);
  const purposes = parseImagePurposes(getFormString(form, 'purposes'));
  const details = parseImageDetails(getFormString(form, 'details'));

  return {
    userId,
    prompt: getFormString(form, 'prompt'),
    preferredTask: getFormString(form, 'preferredTask'),
    images: await buildImageInputsFromFiles({
      files,
      purposes,
      details,
    }),
  };
};

const parseMultipartPlanRequest = async (request: Request, userId: string, username: string) => {
  const form = await request.formData();
  const rawPayload = getFormString(form, 'payload') ?? getFormString(form, 'request');
  const parsedPayload = parseJsonField<Partial<PlanRequestInput>>(rawPayload);
  const payload = parsedPayload === undefined ? {} : parsedPayload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('plan payload must be an object');
  }
  if (payload.user !== undefined && (payload.user === null || typeof payload.user !== 'object' || Array.isArray(payload.user))) {
    throw new Error('plan user must be an object');
  }
  if (payload.inputImages !== undefined && !Array.isArray(payload.inputImages)) {
    throw new Error('inputImages must be an array');
  }
  const files = collectFiles(form, ['inputImages', 'images']);
  const purposes = parseImagePurposes(getFormString(form, 'inputImagePurposes'));
  const details = parseImageDetails(
    getFormString(form, 'inputImageDetails'),
  );
  const multipartImages = await buildImageInputsFromFiles({
    files,
    purposes,
    details,
  });

  return {
    ...payload,
    user: {
      ...(payload.user ?? {}),
      id: userId,
      name: payload.user?.name ?? username,
    },
    inputImages: [...(payload.inputImages ?? []), ...multipartImages],
  };
};

const normalizePlanRequest = (payload: PlanRequestInput, currentUser: { id: string; username: string }) => ({
  ...payload,
  user: {
    ...payload.user,
    id: currentUser.id,
    name: payload.user.name ?? currentUser.username,
  },
});

const normalizeVlmRequest = (
  payload: VlmAnalyzeRequest,
  currentUser: { id: string; username: string },
): VlmAnalyzeRequest => ({
  ...payload,
  userId: currentUser.id,
  prompt: payload.prompt,
});

const createErrorEvent = ({
  requestId,
  stage,
  error,
}: {
  requestId: string;
  stage: string;
  error: unknown;
}) => ({
  id: crypto.randomUUID(),
  requestId,
  type: 'error' as const,
  timestamp: new Date().toISOString(),
  stage,
  summary: error instanceof Error ? `${stage} 阶段失败：${error.message}` : `${stage} 阶段执行失败`,
});

export const createAgentApi = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/api/agent' })
    .use(createAuthContext(runtime))
    .onError(({ error, set }) => {
      if (error instanceof MemoryUnavailableError) {
        set.status = 503;
        return { message: error.message };
      }
      if (error instanceof MemoryNotFoundError) {
        set.status = 404;
        return { message: error.message };
      }
    })
    .post(
      '/vlm/analyze',
      async ({ headers, jwt, request, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const rawPayload = await parseAgentRequest(request, () =>
          parseMultipartVlmRequest(request, currentUser.id));

        if (rawPayload === invalidJsonPayload) {
          set.status = 422;

          return {
            message: 'invalid JSON payload',
          };
        }

        const parsed = vlmAnalyzeRequestSchema.safeParse(rawPayload);

        if (!parsed.success) {
          set.status = 422;

          return {
            message: 'invalid vlm analysis payload',
            issues: parsed.error.flatten(),
          };
        }

        try {
          return await analyzeFitnessImages({
            runtime,
            request: normalizeVlmRequest(parsed.data, currentUser),
          });
        } catch (error) {
          if (error instanceof MemoryUnavailableError || error instanceof MemoryNotFoundError) {
            throw error;
          }
          set.status = 500;

          return {
            message: error instanceof Error ? error.message : 'failed to analyze image input',
          };
        }
      },
      {
        detail: {
          summary: 'Analyze fitness-related images for food calories, equipment questions, or planning context',
          tags: ['agent', 'vlm'],
        },
        // The handler reads Request directly after authentication; do not consume it twice.
        parse: 'none',
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    )
    .post(
      '/vlm/analyze/stream',
      async ({ headers, jwt, request, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const rawPayload = await parseAgentRequest(request, () =>
          parseMultipartVlmRequest(request, currentUser.id));

        if (rawPayload === invalidJsonPayload) {
          set.status = 422;

          return {
            message: 'invalid JSON payload',
          };
        }

        const parsed = vlmAnalyzeRequestSchema.safeParse(rawPayload);

        if (!parsed.success) {
          set.status = 422;

          return {
            message: 'invalid vlm analysis payload',
            issues: parsed.error.flatten(),
          };
        }

        const requestId = crypto.randomUUID();

        return createAgentSseResponse({
          onStart: async (emit) => {
            await analyzeFitnessImages({
              runtime,
              requestId,
              onEvent: emit,
              request: normalizeVlmRequest(parsed.data, currentUser),
            });
          },
          onError: (error) =>
            createErrorEvent({
              requestId,
              stage: 'vlm-analysis',
              error,
            }),
        });
      },
      {
        detail: {
          summary: 'Stream visual analysis progress as SSE events',
          tags: ['agent', 'vlm', 'stream'],
        },
        parse: 'none',
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    )
    .post(
      '/plan',
      async ({ headers, jwt, request, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const rawPayload = await parseAgentRequest(request, () =>
          parseMultipartPlanRequest(request, currentUser.id, currentUser.username));

        if (rawPayload === invalidJsonPayload) {
          set.status = 422;

          return {
            message: 'invalid JSON payload',
          };
        }

        const parsed = planRequestSchema.safeParse(rawPayload);

        if (!parsed.success) {
          set.status = 422;

          return {
            message: 'invalid training plan request payload',
            issues: parsed.error.flatten(),
          };
        }

        try {
          return await generatePlanningResponse({
            runtime,
            request: normalizePlanRequest(parsed.data, currentUser),
          });
        } catch (error) {
          if (error instanceof MemoryUnavailableError || error instanceof MemoryNotFoundError) {
            throw error;
          }
          set.status = 500;

          return {
            message: error instanceof Error ? error.message : 'failed to generate training plan',
          };
        }
      },
      {
        detail: {
          summary:
            'Generate a structured workout plan with dedicated planning workflow, lightweight RAG memory, and optional VLM image context',
          tags: ['agent'],
        },
        parse: 'none',
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    )
    .post(
      '/plan/stream',
      async ({ headers, jwt, request, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const rawPayload = await parseAgentRequest(request, () =>
          parseMultipartPlanRequest(request, currentUser.id, currentUser.username));

        if (rawPayload === invalidJsonPayload) {
          set.status = 422;

          return {
            message: 'invalid JSON payload',
          };
        }

        const parsed = planRequestSchema.safeParse(rawPayload);

        if (!parsed.success) {
          set.status = 422;

          return {
            message: 'invalid training plan request payload',
            issues: parsed.error.flatten(),
          };
        }

        const requestId = crypto.randomUUID();

        return createAgentSseResponse({
          onStart: async (emit) => {
            await generatePlanningResponse({
              runtime,
              requestId,
              onEvent: emit,
              request: normalizePlanRequest(parsed.data, currentUser),
            });
          },
          onError: (error) =>
            createErrorEvent({
              requestId,
              stage: 'plan',
              error,
            }),
        });
      },
      {
        detail: {
          summary: 'Stream training plan generation progress as SSE events',
          tags: ['agent', 'stream'],
        },
        parse: 'none',
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    )
    .post(
      '/memory/session',
      async ({ body, headers, jwt, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const parsed = memoryAppendRequestSchema.safeParse(body);

        if (!parsed.success) {
          set.status = 422;

          return {
            message: 'invalid memory session payload',
            issues: parsed.error.flatten(),
          };
        }

        const storedIds = await runtime.workoutMemoryStore.storeSessions(
          currentUser.id,
          parsed.data.sessions,
        );

        set.status = 201;

        return {
          status: 'stored' as const,
          storedIds,
          totalSessionsForUser: await runtime.workoutMemoryStore.getUserSessionCount(currentUser.id),
        };
      },
      {
        detail: {
          summary: 'Store completed workout sessions for future retrieval',
          tags: ['agent', 'memory'],
        },
        response: {
          201: memoryResponseSchema,
          401: errorResponseSchema,
          422: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    )
    .get(
      '/memory/search',
      async ({ headers, jwt, query, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);
        if (!currentUser) {
          set.status = 401;
          return { message: 'authorization token required' };
        }
        const limit = parseMemoryLimit(query.limit);
        if (limit === null || !query.query.trim()) {
          set.status = 422;
          return { message: 'query must not be blank and limit must be an integer from 1 to 50' };
        }
        return { items: await runtime.workoutMemoryStore.searchMemories(currentUser.id, query.query.trim(), { limit }) };
      },
      {
        query: t.Object({ query: t.String({ minLength: 1, maxLength: 2000 }), limit: memoryLimitSchema }),
        response: { 200: memoryListResponseSchema, 401: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema },
        detail: { summary: 'Search memories belonging to the authenticated user', tags: ['agent', 'memory'] },
      },
    )
    .get(
      '/memory/items',
      async ({ headers, jwt, query, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);
        if (!currentUser) {
          set.status = 401;
          return { message: 'authorization token required' };
        }
        const limit = parseMemoryLimit(query.limit);
        if (limit === null) {
          set.status = 422;
          return { message: 'limit must be an integer from 1 to 50' };
        }
        return { items: await runtime.workoutMemoryStore.listMemories(currentUser.id, limit) };
      },
      {
        query: t.Object({ limit: memoryLimitSchema }),
        response: { 200: memoryListResponseSchema, 401: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema },
        detail: { summary: 'List memories belonging to the authenticated user', tags: ['agent', 'memory'] },
      },
    )
    .patch(
      '/memory/items/:id',
      async ({ headers, jwt, params, body, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);
        if (!currentUser) {
          set.status = 401;
          return { message: 'authorization token required' };
        }
        if (!body.memory.trim()) {
          set.status = 422;
          return { message: 'memory must not be blank' };
        }
        const item = await runtime.workoutMemoryStore.updateMemory(currentUser.id, params.id, body.memory);
        return { status: 'updated' as const, item };
      },
      {
        params: memoryIdParamsSchema,
        body: memoryTextBodySchema,
        response: {
          200: t.Object({ status: t.Literal('updated'), item: storedMemorySchema }),
          401: errorResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema,
        },
        detail: { summary: 'Update a memory belonging to the authenticated user', tags: ['agent', 'memory'] },
      },
    )
    .delete(
      '/memory/items/:id',
      async ({ headers, jwt, params, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);
        if (!currentUser) {
          set.status = 401;
          return { message: 'authorization token required' };
        }
        await runtime.workoutMemoryStore.deleteMemory(currentUser.id, params.id);
        return { status: 'deleted' as const, id: params.id };
      },
      {
        params: memoryIdParamsSchema,
        response: {
          200: t.Object({ status: t.Literal('deleted'), id: t.String() }),
          401: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema,
        },
        detail: { summary: 'Delete a memory belonging to the authenticated user', tags: ['agent', 'memory'] },
      },
    )
    .post(
      '/memory/items',
      async ({ headers, jwt, body, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);
        if (!currentUser) {
          set.status = 401;
          return { message: 'authorization token required' };
        }
        if (!body.memory.trim()) {
          set.status = 422;
          return { message: 'memory must not be blank' };
        }
        const item = await runtime.workoutMemoryStore.createMemory(currentUser.id, body.memory);
        set.status = 201;
        return { status: 'stored' as const, item };
      },
      {
        body: memoryTextBodySchema,
        response: {
          201: t.Object({ status: t.Literal('stored'), item: storedMemorySchema }),
          401: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema,
        },
        detail: { summary: 'Store an authenticated user memory without rewriting the provided text', tags: ['agent', 'memory'] },
      },
    )
    .get(
      '/memory/:userId',
      async ({ headers, jwt, params, query, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        if (params.userId !== 'me' && params.userId !== currentUser.id) {
          set.status = 403;

          return {
            message: 'forbidden for another user',
          };
        }

        const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 10;
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
        const targetUserId = currentUser.id;

        return {
          items: await runtime.workoutMemoryStore.listRecent(targetUserId, limit),
          totalSessionsForUser: await runtime.workoutMemoryStore.getUserSessionCount(targetUserId),
        };
      },
      {
        detail: {
          summary: 'List recent stored workout sessions for the authenticated user',
          tags: ['agent', 'memory'],
        },
        params: t.Object({
          userId: t.String({ minLength: 1, maxLength: 120 }),
        }),
        query: t.Object({
          limit: t.Optional(t.String()),
        }),
        response: {
          200: t.Object({
            items: t.Array(t.Any()),
            totalSessionsForUser: t.Number({ minimum: 0 }),
          }),
          401: errorResponseSchema,
          403: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    );
