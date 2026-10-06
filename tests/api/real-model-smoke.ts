import { createHarness, credentials, planRequest } from './fixtures';
import { planApiResponseSchema } from '../../src/agent/shared/types';

// Separate process from contract tests: no HTTP/model mocks are installed here.
if (Bun.env.RUN_REAL_MODEL_TEST !== '1') {
  console.log('Set RUN_REAL_MODEL_TEST=1 to run one real authenticated plan API request.');
  process.exit(0);
}
const key = Bun.env.AI_PROVIDER_API_KEY ?? Bun.env.AI_GATEWAY_API_KEY;
if (!key) { console.log('Skipped: no AI provider API key is configured.'); process.exit(0); }

const h = createHarness();
const originalFetch = globalThis.fetch;
const controller = new AbortController();
const timeoutMs = Number(Bun.env.REAL_MODEL_TIMEOUT_MS ?? 60_000);
const timer = setTimeout(() => controller.abort(new Error('Real model smoke deadline exceeded')), timeoutMs);
const providerBaseUrl = Bun.env.AI_PROVIDER_BASE_URL ?? 'https://api.siliconflow.cn/v1';
const allowedOrigin = new URL(providerBaseUrl).origin;
const calls: Array<{ url: string; status?: number; durationMs: number; error?: string }> = [];
const started = performance.now();
const safe = (error: unknown) => String(error).replaceAll(key, '[redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
let passed = false;
const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(), mode: 'REAL provider HTTP; real createApp.handle; isolated FakeMem0Adapter runtime',
  providerBaseUrl, model: Bun.env.GYM_AGENT_MODEL ?? 'Pro/zai-org/GLM-5', timeoutMs,
};
const timedFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).origin !== allowedOrigin) throw new Error('Unexpected network origin in real model smoke');
  if (calls.length >= 6) throw new Error('Real model smoke exceeded six provider calls');
  const item: typeof calls[number] = { url, durationMs: 0 };
  calls.push(item);
  const callStart = performance.now();
  try {
    const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    const response = await originalFetch(input, { ...init, signal });
    item.status = response.status;
    return response;
  } catch (error) { item.error = safe(error); throw error; }
  finally { item.durationMs = performance.now() - callStart; }
};
globalThis.fetch = Object.assign(timedFetch, { preconnect: originalFetch.preconnect });

try {
  const post = (path: string, body: unknown, token?: string) => h.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: controller.signal,
  }));
  const registered = await post('/api/auth/register', credentials);
  if (registered.status !== 201) throw new Error(`register returned ${registered.status}`);
  await registered.text();
  const login = await post('/api/auth/login', credentials);
  if (login.status !== 200) throw new Error(`login returned ${login.status}`);
  const auth = await login.json() as { token: string };
  report.auth = { register: registered.status, login: login.status };
  console.log('Real model smoke: register=201 login=200; requesting authenticated /api/agent/plan');
  const response = await post('/api/agent/plan', planRequest(), auth.token);
  const body = await response.json();
  report.httpStatus = response.status;
  if (response.status === 200) {
    const result = planApiResponseSchema.parse(body);
    report.contractValid = true;
    report.reviewStatus = result.review.status;
    report.planTitle = result.plan.title;
    report.weeklyFrequency = result.plan.weeklyFrequency;
    report.finalEvent = result.agentEvents.at(-1)?.type;
    report.response = result;
    passed = result.agentEvents.at(-1)?.type === 'final' && result.review.status === 'pass';
  } else { report.response = JSON.parse(safe(JSON.stringify(body))); }
} catch (error) { report.error = safe(error); }
finally {
  clearTimeout(timer);
  globalThis.fetch = originalFetch;
  h.close();
  report.passed = passed; report.elapsedMs = performance.now() - started;
  report.providerCalls = calls;
  const path = Bun.env.REAL_MODEL_REPORT_PATH ?? '/tmp/chatgym-api-real-model.json';
  await Bun.write(path, JSON.stringify(report, null, 2));
  const { response, ...summary } = report;
  console.log(JSON.stringify({ ...summary, reportPath: path }, null, 2));
}
process.exitCode = passed ? 0 : 1;
