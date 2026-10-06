import { FakeMem0Adapter } from '../../../../tests/helpers/fake-mem0-adapter';
import type { ServerRuntime } from '../../../runtime';
import { TextStore } from '../../../services/text-store';
import { TextStreamHub } from '../../../services/text-stream-hub';
import { UserStore } from '../../../services/user-store';
import { planRequestSchema, trainingPlanSchema, type WorkoutMemoryInput } from '../types';
import { WorkoutMemoryStore } from '../workout-memory-store';

export const createMemoryFixture = (_onDisk = false) => {
  const adapter = new FakeMem0Adapter();
  return { store: new WorkoutMemoryStore(adapter), adapter, close() { adapter.records.clear(); } };
};

export const createTestRuntime = (store: WorkoutMemoryStore): ServerRuntime => ({
  serviceName: 'chatgym-test',
  startedAt: new Date(),
  textStore: new TextStore(),
  textStreamHub: new TextStreamHub(),
  userStore: new UserStore(),
  workoutMemoryStore: store,
});

export const createSessions = (count: number, prefix = 'session'): WorkoutMemoryInput[] =>
  Array.from({ length: count }, (_, index) => ({
    sourceId: `${prefix}-${index}`,
    completedAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    sessionType: 'strength',
    durationMinutes: 60,
    exerciseNames: ['卧推', '龙门架夹胸'],
    muscleGroups: ['胸'],
    intensity: 'medium',
    goalTag: 'muscle_gain',
    notes: '胸部训练，完成训练后记录恢复情况。',
  }));

export const seedSessions = async (store: WorkoutMemoryStore, count: number) => {
  for (let index = 0; index < count; index++) {
    await store.storeSession(`user-${Math.floor(index / 100)}`, {
      ...createSessions(1)[0]!, sourceId: `seed-${index}`,
      completedAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    });
  }
};

export const createPlanRequest = () => planRequestSchema.parse({
  mode: 'plan',
  user: { id: 'user-0', trainingExperience: 'intermediate' },
  goal: { primary: 'muscle_gain', targetAreas: ['胸'] },
  schedule: { availableDaysPerWeek: 1, sessionDurationMinutes: 60 },
  preferences: { equipment: ['杠铃', '训练凳'] },
});

export const createValidPlan = () => trainingPlanSchema.parse({
  title: '胸部训练计划', objective: '胸部增肌', planHorizon: '1_week', weeklyFrequency: 1,
  summary: '每周完成一次胸部训练。',
  suitability: { whyItFits: ['符合训练频率', '符合器械条件'], riskControls: ['保持动作稳定'] },
  weeklySchedule: [{
    dayIndex: 1, dayLabel: '周一', focus: '胸部', goal: '胸部增肌', intensity: 'medium',
    durationMinutes: 60, warmup: ['低强度热身'],
    mainBlocks: [{
      title: '主训练', purpose: '完成胸部训练',
      exercises: [{
        name: '卧推', sets: 4, reps: 10, restSeconds: 90, intensity: 'RPE 7',
        primaryMuscles: ['胸'], coachingCue: '稳定控制动作', alternatives: ['蝴蝶飞鸟'],
      }],
    }],
    cooldown: ['轻度拉伸'], notes: ['记录完成情况'], recoveryWindowHours: 48,
  }],
  progressionRules: ['先保证动作质量', '逐步增加次数', '达到目标后再加重量'],
  recoveryGuidance: ['记录恢复情况', '保持规律作息'],
  metricsToTrack: ['训练次数', '训练重量', '恢复情况'], warnings: [],
});

export const visionResult = {
  task: 'training_plan_context', summary: '图片中可见杠铃和训练凳。',
  results: [{
    imageIndex: 0, declaredPurpose: null, classification: 'equipment',
    possibleTasks: ['training_plan_context'], observations: ['可见杠铃'],
    foodAnalysis: null, equipmentAnalysis: null, trainingContext: ['可以进行卧推'],
  }],
};

export const testImageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=';

export const toolReply = {
  tool_calls: [{
    id: 'recommend-1', type: 'function',
    function: {
      name: 'recommendExercises',
      arguments: JSON.stringify({
        focus: '胸部增肌', targetMuscles: ['胸'], availableEquipment: ['杠铃'],
        avoidExercises: [], trainingExperience: 'intermediate', limit: 3,
      }),
    },
  }],
};

type ModelReply = string | typeof toolReply;

// Exercise the real SDK and workflow via a simulated HTTP boundary. Never send
// credentials, images, or prompts to a remote provider, even if .env is loaded.
export const withModelReplies = async <T>(
  replies: ModelReply[],
  run: () => Promise<T>,
  latencyMs = 0,
) => {
  const keys = ['AI_PROVIDER_BASE_URL', 'AI_PROVIDER_API_KEY'] as const;
  const previous = keys.map((key) => Bun.env[key]);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ durationMs: number; requestBytes: number }> = [];
  let imageDownloads = 0;
  Bun.env.AI_PROVIDER_BASE_URL = 'https://chatgym-test.invalid/v1';
  Bun.env.AI_PROVIDER_API_KEY = 'test-key';
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://chatgym-test.invalid/image.png') {
      imageDownloads++;
      return new Response(Buffer.from(testImageDataUrl.split(',')[1]!, 'base64'), {
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url !== 'https://chatgym-test.invalid/v1/chat/completions') {
      throw new Error(`Unexpected network request in test: ${url}`);
    }
    const reply = replies[calls.length];
    if (reply === undefined) throw new Error('Workflow exceeded the scripted model call count');
    const call = { durationMs: 0, requestBytes: new TextEncoder().encode(String(init?.body ?? '')).length };
    calls.push(call);
    const started = performance.now();
    if (latencyMs > 0) await Bun.sleep(latencyMs);
    call.durationMs = performance.now() - started;
    return Response.json({
      id: `completion-${calls.length}`, object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{
        index: 0, finish_reason: typeof reply === 'string' ? 'stop' : 'tool_calls',
        message: { role: 'assistant', content: typeof reply === 'string' ? reply : null,
          ...(typeof reply === 'string' ? {} : reply) },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    });
  };
  globalThis.fetch = Object.assign(fakeFetch, { preconnect: originalFetch.preconnect });
  try {
    const started = performance.now();
    const value = await run();
    return { value, calls, imageDownloads, elapsedMs: performance.now() - started };
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete Bun.env[key];
      else Bun.env[key] = previous[index];
    });
  }
};
