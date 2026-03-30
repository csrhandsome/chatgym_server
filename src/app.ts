import { Elysia, t } from 'elysia';
import { createAgentApi } from './api/agent';
import { createAuthApi } from './api/auth';
import { createHealthApi } from './api/health';
import { createTextApi } from './api/text';
import { createRuntime, type ServerRuntime } from './runtime';
import { createTextWs } from './ws/text';

export const createApp = (runtime: ServerRuntime = createRuntime()) =>
  new Elysia()
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
