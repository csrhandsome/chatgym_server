import { Elysia, t } from 'elysia';
import { createAgentApi } from './api/agent';
import { createAuthApi } from './api/auth';
import { createHealthApi } from './api/health';
import { createTextApi } from './api/text';
import { createRuntime, type ServerRuntime } from './runtime';
import { createTextWs } from './ws/text';

const DEFAULT_CORS_ALLOW_HEADERS = 'authorization, content-type';
const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-origin': '*',
  'access-control-max-age': '86400',
} as const;

export const createApp = (runtime: ServerRuntime = createRuntime()) =>
  new Elysia()
    .onRequest(({ request, set }) => {
      set.headers['access-control-allow-methods'] =
        CORS_HEADERS['access-control-allow-methods'];
      set.headers['access-control-allow-origin'] =
        CORS_HEADERS['access-control-allow-origin'];
      set.headers['access-control-max-age'] = CORS_HEADERS['access-control-max-age'];
      set.headers['access-control-allow-headers'] =
        request.headers.get('access-control-request-headers') ??
        DEFAULT_CORS_ALLOW_HEADERS;

      if (request.method === 'OPTIONS') {
        set.status = 204;
        return '';
      }
    })
    .get(
      '/',
      () => ({
        service: runtime.serviceName,
        message: 'chatgym_server is ready',
        api: {
          health: '/api/health',
          register: '/api/auth/register',
          login: '/api/auth/login',
          me: '/api/auth/me',
          textCollection: '/api/text',
          imageAnalysis: '/api/agent/vlm/analyze',
          imageAnalysisStream: '/api/agent/vlm/analyze/stream',
          trainingPlanner: '/api/agent/plan',
          trainingPlannerStream: '/api/agent/plan/stream',
          coachPersonas: '/api/agent/coaches',
          dailyPlanner: '/api/agent/daily',
          dailyPlannerStream: '/api/agent/daily/stream',
          workoutMemory: '/api/agent/memory/session',
        },
        ws: {
          textStream: '/ws/text',
        },
      }),
      {
        response: t.Object({
          service: t.String(),
          message: t.String(),
          api: t.Object({
            health: t.String(),
            register: t.String(),
            login: t.String(),
            me: t.String(),
            textCollection: t.String(),
            imageAnalysis: t.String(),
            imageAnalysisStream: t.String(),
            trainingPlanner: t.String(),
            trainingPlannerStream: t.String(),
            workoutMemory: t.String(),
          }),
          ws: t.Object({
            textStream: t.String(),
          }),
        }),
      },
    )
    .use(createAgentApi(runtime))
    .use(createAuthApi(runtime))
    .use(createHealthApi(runtime))
    .use(createTextApi(runtime))
    .use(createTextWs(runtime));
