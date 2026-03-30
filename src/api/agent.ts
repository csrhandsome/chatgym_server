import { Elysia, t } from 'elysia';
import { generateTrainingPlan } from '../agent/planning/workflows/generate-training-plan';
import {
  memoryAppendRequestSchema,
  type PlanImageInput,
  planRequestSchema,
  type PlanRequestInput,
  type VlmAnalyzeRequest,
  vlmAnalyzeRequestSchema,
} from '../agent/shared/types';
import { analyzeFitnessImages } from '../agent/vlm/workflows/analyze-fitness-images';
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

const getFormString = (form: MultipartFormData, key: string) => {
  const value = form.get(key);

  return typeof value === 'string' ? value : undefined;
};

const parseJsonField = <T>(raw: string | undefined): T | undefined => {
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as T;
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
  const purposes = parseJsonField<string[]>(getFormString(form, 'purposes'));
  const details = parseJsonField<Array<'auto' | 'low' | 'high'>>(getFormString(form, 'details'));

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
  const payload = parseJsonField<Partial<PlanRequestInput>>(rawPayload) ?? {};
  const files = collectFiles(form, ['inputImages', 'images']);
  const purposes = parseJsonField<string[]>(getFormString(form, 'inputImagePurposes'));
  const details = parseJsonField<Array<'auto' | 'low' | 'high'>>(
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
  summary: error instanceof Error ? error.message : `failed during ${stage}`,
});

export const createAgentApi = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/api/agent' })
    .use(createAuthContext(runtime))
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

        const rawPayload = isMultipartRequest(headers['content-type'])
          ? await parseMultipartVlmRequest(request, currentUser.id)
          : await parseJsonRequest(request);

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
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
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

        const rawPayload = isMultipartRequest(headers['content-type'])
          ? await parseMultipartVlmRequest(request, currentUser.id)
          : await parseJsonRequest(request);

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

        const rawPayload = isMultipartRequest(headers['content-type'])
          ? await parseMultipartPlanRequest(request, currentUser.id, currentUser.username)
          : await parseJsonRequest(request);

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
          return await generateTrainingPlan({
            runtime,
            request: normalizePlanRequest(parsed.data, currentUser),
          });
        } catch (error) {
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
        response: {
          200: t.Any(),
          401: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
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

        const rawPayload = isMultipartRequest(headers['content-type'])
          ? await parseMultipartPlanRequest(request, currentUser.id, currentUser.username)
          : await parseJsonRequest(request);

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
            await generateTrainingPlan({
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

        const storedIds = runtime.workoutMemoryStore.storeSessions(
          currentUser.id,
          parsed.data.sessions,
        );

        set.status = 201;

        return {
          status: 'stored' as const,
          storedIds,
          totalSessionsForUser: runtime.workoutMemoryStore.getUserSessionCount(currentUser.id),
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
        },
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
          items: runtime.workoutMemoryStore.listRecent(targetUserId, limit),
          totalSessionsForUser: runtime.workoutMemoryStore.getUserSessionCount(targetUserId),
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
        },
      },
    );
