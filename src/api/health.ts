import { Elysia, t } from 'elysia';
import type { ServerRuntime } from '../runtime';
import { buildRuntimeSnapshot } from '../runtime';
import { userStoreSummarySchema } from '../types/auth';
import { textStoreSummarySchema } from '../types/text';

const healthResponseSchema = t.Object({
  status: t.Literal('ok'),
  service: t.String(),
  startedAt: t.String({ format: 'date-time' }),
  uptimeMs: t.Number({ minimum: 0 }),
  auth: userStoreSummarySchema,
  agent: t.Object({
    totalStoredSessions: t.Number({ minimum: 0 }),
    uniqueUsers: t.Number({ minimum: 0 }),
    latestSessionAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
  }),
  text: textStoreSummarySchema,
  ws: t.Object({
    activeConnections: t.Number({ minimum: 0 }),
  }),
});

export const createHealthApi = (runtime: ServerRuntime) =>
  new Elysia({ prefix: '/api' }).get(
    '/health',
    () => ({
      status: 'ok' as const,
      service: runtime.serviceName,
      startedAt: runtime.startedAt.toISOString(),
      uptimeMs: Date.now() - runtime.startedAt.getTime(),
      ...buildRuntimeSnapshot(runtime),
    }),
    {
      detail: {
        summary: 'Check server health and runtime summary',
        tags: ['system'],
      },
      response: healthResponseSchema,
    },
  );
