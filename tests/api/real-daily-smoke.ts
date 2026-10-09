import { createHarness, credentials } from './fixtures';
import { planDailyResponseSchema } from '../../src/agent/shared/types';
import type { PlanDailyResponse } from '../../src/agent/shared/types';

// Real provider HTTP against the daily-plan endpoint. Verifies that ordinary
// chat prompts ("普通的提示词") produce coach-shaped single-day plans.
if (Bun.env.RUN_REAL_MODEL_TEST !== '1') {
  console.log('Set RUN_REAL_MODEL_TEST=1 to run the real daily-plan smoke.');
  process.exit(0);
}

const key = Bun.env.AI_PROVIDER_API_KEY ?? Bun.env.AI_GATEWAY_API_KEY;
if (!key) {
  console.log('Skipped: no AI provider API key is configured.');
  process.exit(0);
}

type Case = { label: string; coachId?: string; requestNote: string; targetAreas: string[] };

const CASES: Case[] = [
  {
    label: 'generic (无教练，普通提示词)',
    requestNote: '我练了一年，一周三练，每次一小时，主要想增肌。今天想练胸，帮我把今天的训练安排出来。',
    targetAreas: ['胸'],
  },
  {
    label: '谭成义',
    coachId: 'tan-chengyi',
    requestNote: '想按谭成义的三分化来练。今天是推的日子，只有一个小时，帮我把今天的推类安排出来。',
    targetAreas: ['胸'],
  },
  {
    label: '凯圣王',
    coachId: 'kai-shengwang',
    requestNote: '想跟凯圣王的快速三分化，这周想练四次。今天是拉日，帮我排一下今天的背部训练。',
    targetAreas: ['背'],
  },
  {
    label: '心平气和的张老师',
    coachId: 'zhang-laoshi',
    requestNote: '最近练得有点累，睡眠一般，今天想练背但别太猛，帮我安排一下，别让我过度训练。',
    targetAreas: ['背'],
  },
  {
    label: '通用科学增肌',
    coachId: 'science-muscle',
    requestNote: '新手，第一次进健身房，想练腿，四十分钟，只有杠铃和深蹲架，帮我安排今天。',
    targetAreas: ['腿'],
  },
];

const limit = Bun.env.REAL_DAILY_CASES ? Number(Bun.env.REAL_DAILY_CASES) : CASES.length;
const cases = CASES.slice(0, Math.max(1, limit));

const h = createHarness();
const originalFetch = globalThis.fetch;
const providerBaseUrl = Bun.env.AI_PROVIDER_BASE_URL ?? 'https://api.deepseek.com/v1';
const allowedOrigin = new URL(providerBaseUrl).origin;
const timeoutMs = Number(Bun.env.REAL_MODEL_TIMEOUT_MS ?? 90_000);

const safe = (error: unknown) =>
  String(error).replaceAll(key, '[redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');

let providerCalls = 0;
const timedFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).origin !== allowedOrigin) {
    throw new Error('Unexpected network origin in real daily smoke');
  }
  providerCalls += 1;
  return originalFetch(input, init);
};
globalThis.fetch = Object.assign(timedFetch, { preconnect: originalFetch.preconnect });

const post = (path: string, body: unknown, token?: string) =>
  h.app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }),
  );

const summarize = (result: PlanDailyResponse) => ({
  persona: result.persona.name,
  title: result.dailyPlan.title,
  focus: result.dailyPlan.focus,
  intensity: result.dailyPlan.intensity,
  durationMinutes: result.dailyPlan.durationMinutes,
  reviewScore: result.review.score,
  reviewStatus: result.review.status,
  blocks: result.dailyPlan.mainBlocks.map((block) => ({
    title: block.title,
    exercises: block.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`),
  })),
  coachTips: result.dailyPlan.coachTips,
});

const results: Array<Record<string, unknown>> = [];
let passed = 0;

try {
  const registered = await post('/api/auth/register', { ...credentials, username: 'real_daily_user' });
  const login = await post('/api/auth/login', { ...credentials, username: 'real_daily_user' });
  if (login.status !== 200) {
    throw new Error(`login returned ${login.status}`);
  }
  const auth = (await login.json()) as { token: string };
  console.log(`Real daily smoke: register=${registered.status} login=200; running ${cases.length} case(s)`);

  for (const testCase of cases) {
    const started = performance.now();
    try {
      const response = await post(
        '/api/agent/daily',
        {
          user: { id: 'ignored', trainingExperience: 'intermediate' },
          goal: { primary: 'muscle_gain', targetAreas: testCase.targetAreas, requestNote: testCase.requestNote },
          schedule: { availableDaysPerWeek: 3, sessionDurationMinutes: 60 },
          coachId: testCase.coachId,
        },
        auth.token,
      );

      const body = await response.json();
      const elapsedMs = Math.round(performance.now() - started);

      if (response.status !== 200) {
        results.push({ label: testCase.label, status: response.status, error: safe(JSON.stringify(body)) });
        continue;
      }

      const result = planDailyResponseSchema.parse(body);
      results.push({ label: testCase.label, status: 200, elapsedMs, plan: summarize(result) });
      passed += 1;
    } catch (error) {
      results.push({ label: testCase.label, error: safe(error) });
    }
  }
} catch (error) {
  results.push({ label: 'setup', error: safe(error) });
} finally {
  globalThis.fetch = originalFetch;
  h.close();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'REAL provider HTTP; real createApp.handle; isolated FakeMem0Adapter runtime',
    providerBaseUrl,
    model: Bun.env.GYM_AGENT_MODEL ?? 'Pro/zai-org/GLM-5',
    passed,
    total: cases.length,
    providerCalls,
    results,
  };
  const path = Bun.env.REAL_DAILY_REPORT_PATH ?? '/tmp/chatgym-daily-real-model.json';
  await Bun.write(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  console.log(`report: ${path}`);
}

process.exitCode = passed === cases.length ? 0 : 1;
