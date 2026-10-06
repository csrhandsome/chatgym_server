import { createApp } from '../../src/app';
import type { ServerRuntime } from '../../src/runtime';
import { TextStore } from '../../src/services/text-store';
import { TextStreamHub } from '../../src/services/text-stream-hub';
import { UserStore } from '../../src/services/user-store';
import { WorkoutMemoryStore } from '../../src/agent/shared/workout-memory-store';
import type { Mem0Adapter } from '../../src/agent/shared/mem0-adapter';
import { FakeMem0Adapter } from '../helpers/fake-mem0-adapter';
import { planRequestSchema, trainingPlanSchema } from '../../src/agent/shared/types';

export const credentials = { username: 'api_alice', password: 'Only-Test-Password-42' };
export const bobCredentials = { ...credentials, username: 'api_bob' };
export const imageUrl = 'https://api-contract.invalid/image.png';
export const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=';

export function createHarness(userStore = new UserStore(), adapter: Mem0Adapter = new FakeMem0Adapter()) {
  const store = new WorkoutMemoryStore(adapter);
  const runtime: ServerRuntime = {
    serviceName: 'chatgym-api-integration', startedAt: new Date(),
    textStore: new TextStore(), textStreamHub: new TextStreamHub(),
    userStore, workoutMemoryStore: store,
  };
  // Mem0 test double is process-local and needs no cleanup; callers can reuse the account Store.
  return { runtime, app: createApp(runtime), adapter, close: () => {} };
}

export const session = () => ({
  sourceId: 'api-session', completedAt: '2026-10-01T10:00:00.000Z',
  sessionType: 'strength', durationMinutes: 60, exerciseNames: ['卧推'],
  muscleGroups: ['胸'], intensity: 'medium', goalTag: 'muscle_gain', notes: 'API test only',
});

export const planRequest = () => planRequestSchema.parse({
  mode: 'plan', user: { id: 'chatgym-user', trainingExperience: 'intermediate' },
  goal: { primary: 'muscle_gain', targetAreas: ['胸'] },
  schedule: { availableDaysPerWeek: 1, sessionDurationMinutes: 60 },
  preferences: { equipment: ['杠铃', '训练凳'] },
});

// Same shape as services/agent-api.ts:createAgentPlanPayload in the frontend.
export const frontendChatRequest = () => ({
  currentState: { soreness: [] },
  goal: { primary: 'general_fitness', requestNote: '请制定一周训练计划', secondary: [], targetAreas: [] },
  preferences: { avoidExercises: [], equipment: [], preferredExercises: [], workoutLocation: 'gym' },
  rememberedWorkouts: [],
  schedule: { availableDaysPerWeek: 3, preferredDays: [], sessionDurationMinutes: 60 },
  user: { id: 'chatgym-user', injuries: [], limitations: [], name: 'ChatGym User', trainingExperience: 'intermediate' },
});

export function validPlan(days = 1) {
  return trainingPlanSchema.parse({
    title: '接口测试训练计划', objective: '胸部增肌', planHorizon: '1_week', weeklyFrequency: days,
    summary: '按计划完成训练。',
    suitability: { whyItFits: ['符合训练频率', '符合器械条件'], riskControls: ['保持动作稳定'] },
    weeklySchedule: Array.from({ length: days }, (_, i) => ({
      dayIndex: 1 + i * 2, dayLabel: `第${1 + i * 2}天`, focus: '胸部', goal: '胸部增肌', intensity: 'medium',
      durationMinutes: 60, warmup: ['低强度热身'],
      mainBlocks: [{ title: '主训练', purpose: '胸部训练', exercises: [{
        name: '卧推', sets: 4, reps: 10, restSeconds: 90, intensity: 'RPE 7',
        primaryMuscles: ['胸'], coachingCue: '稳定控制动作', alternatives: ['蝴蝶飞鸟'],
      }] }],
      cooldown: ['轻度拉伸'], notes: ['记录完成情况'], recoveryWindowHours: 48,
    })),
    progressionRules: ['先保证动作质量', '逐步增加次数', '达到目标后再加重量'],
    recoveryGuidance: ['记录恢复情况', '保持规律作息'],
    metricsToTrack: ['训练次数', '训练重量', '恢复情况'], warnings: [],
  });
}

export const visionReply = () => ({
  task: 'food_calorie_estimate', summary: '测试图片中的米饭热量约为 100 至 150 千卡。',
  results: [{
    imageIndex: 0, declaredPurpose: 'food calorie estimate', classification: 'food',
    possibleTasks: ['food_calorie_estimate'], observations: ['一份米饭'],
    foodAnalysis: { items: [{ name: '米饭', portionEstimate: '小份', caloriesLow: 100, caloriesHigh: 150,
      confidence: 'low', assumptions: ['仅用于模拟契约'] }], totalCaloriesLow: 100, totalCaloriesHigh: 150,
      assumptions: ['仅用于模拟契约'] },
    equipmentAnalysis: null, trainingContext: [],
  }],
});

export const recommendToolReply = {
  tool_calls: [{ id: 'api-recommend-1', type: 'function', function: {
    name: 'recommendExercises', arguments: JSON.stringify({ focus: '胸部增肌', targetMuscles: ['胸'],
      availableEquipment: ['杠铃'], avoidExercises: [], trainingExperience: 'intermediate', limit: 3 }),
  } }],
};

type Reply = string | typeof recommendToolReply | { httpError: number; message: string };

// Mock only provider HTTP and one synthetic HTTPS image. Real router, JWT,
// validators, SDK, tools, workflow, review, SSE and async WorkoutMemoryStore remain in use.
// Run serially; never combine this suite with --concurrent.
export async function withModelReplies<T>(replies: Reply[], run: () => Promise<T>) {
  const keys = ['AI_PROVIDER_API_KEY', 'AI_PROVIDER_BASE_URL'] as const;
  const previous = keys.map(key => Bun.env[key]);
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  let imageDownloads = 0;
  Bun.env.AI_PROVIDER_API_KEY = 'contract-test-key';
  Bun.env.AI_PROVIDER_BASE_URL = 'https://api-contract.invalid/v1';
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === imageUrl) {
      imageDownloads++;
      return new Response(Buffer.from(imageDataUrl.split(',')[1]!, 'base64'), { headers: { 'content-type': 'image/png' } });
    }
    if (url !== 'https://api-contract.invalid/v1/chat/completions') {
      throw new Error(`Blocked unexpected network request: ${url}`);
    }
    const reply = replies[calls.length];
    if (reply === undefined) throw new Error('Unexpected extra model call');
    calls.push(JSON.parse(String(init?.body ?? '{}')));
    if (typeof reply === 'object' && 'httpError' in reply) {
      return Response.json({ error: { message: reply.message } }, { status: reply.httpError });
    }
    return Response.json({
      id: `api-completion-${calls.length}`, object: 'chat.completion', created: 1, model: 'contract-model',
      choices: [{ index: 0, finish_reason: typeof reply === 'string' ? 'stop' : 'tool_calls',
        message: { role: 'assistant', content: typeof reply === 'string' ? reply : null,
          ...(typeof reply === 'string' ? {} : reply) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    });
  };
  globalThis.fetch = Object.assign(fakeFetch, { preconnect: originalFetch.preconnect });
  try { return { value: await run(), calls, imageDownloads }; }
  finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete Bun.env[key]; else Bun.env[key] = previous[i]; });
  }
}
