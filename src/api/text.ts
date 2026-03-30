import { Elysia, t } from 'elysia';
import { createAuthContext, resolveAuthenticatedUser } from '../plugins/auth';
import type { ServerRuntime } from '../runtime';
import { buildRuntimeSnapshot } from '../runtime';
import { authErrorSchema } from '../types/auth';
import { submitTextSchema, textRecordSchema } from '../types/text';

const blankTextErrorSchema = t.Object({
  message: t.String(),
});

const textListResponseSchema = t.Object({
  items: t.Array(textRecordSchema),
  count: t.Number({ minimum: 0 }),
});

const createStatsEvent = (runtime: ServerRuntime) => ({
  type: 'server:stats',
  timestamp: new Date().toISOString(),
  ...buildRuntimeSnapshot(runtime),
});

const publishTextReceived = (runtime: ServerRuntime) => {
  runtime.textStreamHub.broadcast(createStatsEvent(runtime));
};

export const createTextApi = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/api' })
    .use(createAuthContext(runtime))
    .post(
      '/text',
      async ({ body, headers, jwt, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        if (body.text.trim().length === 0) {
          set.status = 422;

          return {
            message: 'text cannot be blank',
          };
        }

        const record = runtime.textStore.add({
          ...body,
          source: body.source ?? 'api',
          userId: currentUser.id,
          username: currentUser.username,
        });

        publishTextReceived(runtime);
        set.status = 201;

        return {
          status: 'accepted' as const,
          record,
        };
      },
      {
        detail: {
          summary: 'Receive text from frontend clients',
          tags: ['text'],
        },
        body: submitTextSchema,
        response: {
          401: authErrorSchema,
          201: t.Object({
            status: t.Literal('accepted'),
            record: textRecordSchema,
          }),
          422: blankTextErrorSchema,
        },
      },
    )
    .get(
      '/text',
      async ({ headers, jwt, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const items = runtime.textStore.listRecentForUser(currentUser.id);

        return {
          items,
          count: items.length,
        };
      },
      {
        detail: {
          summary: 'List the authenticated user text payloads',
          tags: ['text'],
        },
        response: {
          200: textListResponseSchema,
          401: authErrorSchema,
        },
      },
    )
    .get(
      '/text/:id',
      async ({ headers, jwt, params, set }) => {
        const currentUser = await resolveAuthenticatedUser(runtime, headers.authorization, jwt);

        if (!currentUser) {
          set.status = 401;

          return {
            message: 'authorization token required',
          };
        }

        const record = runtime.textStore.getByIdForUser(params.id, currentUser.id);

        if (!record) {
          set.status = 404;

          return {
            message: 'text record not found',
          };
        }

        return {
          record,
        };
      },
      {
        detail: {
          summary: 'Get one collected text payload by id',
          tags: ['text'],
        },
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
        response: {
          401: authErrorSchema,
          200: t.Object({
            record: textRecordSchema,
          }),
          404: blankTextErrorSchema,
        },
      },
    );
