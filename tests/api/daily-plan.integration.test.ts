import { describe, expect, test } from 'bun:test';
import { planDailyResponseSchema } from '../../src/agent/shared/types';
import { createHarness, credentials, withModelReplies } from './fixtures';

// A valid single-day plan the mocked provider returns as its assistant message.
const dailyPlanReply = JSON.stringify({
  date: '2026-10-09',
  dayLabel: '今天',
  title: '胸肩推举日',
  focus: '胸部推举 + 手臂',
  goal: '在精力一般的情况下完成一次质量优先的推类训练',
  intensity: 'medium',
  durationMinutes: 55,
  warmup: ['跑步机 5 分钟快走', '肩袖激活与空杆热身'],
  mainBlocks: [
    {
      title: '主项',
      purpose: '水平推举',
      exercises: [
        {
          name: '卧推',
          sets: 4,
          reps: 8,
          restSeconds: 120,
          intensity: 'RPE 7',
          primaryMuscles: ['胸'],
          coachingCue: '肩胛后收下沉，下放到胸中部后稳定推起。',
          alternatives: ['蝴蝶飞鸟'],
        },
        {
          name: '哑铃弯举',
          sets: 3,
          reps: 12,
          restSeconds: 60,
          intensity: 'RPE 8',
          primaryMuscles: ['手臂'],
          coachingCue: '上臂贴近身体，顶端主动收缩。',
          alternatives: [],
        },
      ],
    },
  ],
  cooldown: ['胸肩拉伸 5 分钟'],
  notes: ['记录卧推完成重量'],
  coachTips: ['今天状态一般，先把动作做标准，别急着加重量。'],
  adaptations: ['把卧推从 5 组降到 4 组'],
  recoveryWindowHours: 48,
});

type Json = Record<string, any>;

const jsonPost = (path: string, body: unknown, token?: string) => {
  const h = currentHarness;
  return h.app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
};

let currentHarness: ReturnType<typeof createHarness>;

const registerAndLogin = async (h: ReturnType<typeof createHarness>, username: string) => {
  const input = { ...credentials, username };
  await h.app.handle(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const login = await h.app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const body = (await login.json()) as { token: string };
  return body.token;
};

const dailyRequest = (extra: Json = {}) => ({
  user: { id: 'chatgym-user', trainingExperience: 'intermediate' },
  goal: { primary: 'muscle_gain', targetAreas: ['胸'], requestNote: '今天有点累，但还是想练胸' },
  schedule: { availableDaysPerWeek: 3, sessionDurationMinutes: 60 },
  ...extra,
});

// Memory is scoped by the payload `user.id`, while the memory API scopes by the
// authenticated user, so a cross-day memory test has to use one id for both.
const registerAndLoginWithId = async (h: ReturnType<typeof createHarness>, username: string) => {
  const input = { ...credentials, username };
  await h.app.handle(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const login = await h.app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const body = (await login.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
};

describe('coach persona catalog', () => {
  test('lists the preset coaches without authentication', async () => {
    currentHarness = createHarness();
    const response = await currentHarness.app.handle(
      new Request('http://localhost/api/agent/coaches'),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Json[] };
    expect(body.items).toHaveLength(6);

    const ids = body.items.map((item) => item.id);
    expect(ids).toContain('tan-chengyi');
    expect(ids).toContain('zhang-laoshi');

    currentHarness.close();
  });
});

describe('POST /api/agent/daily', () => {
  test('rejects unauthenticated requests', async () => {
    currentHarness = createHarness();
    const response = await jsonPost('/api/agent/daily', dailyRequest());
    expect(response.status).toBe(401);
    currentHarness.close();
  });

  test('returns a schema-valid single-day plan shaped by the selected coach', async () => {
    const h = createHarness();
    currentHarness = h;
    const token = await registerAndLogin(h, 'daily_alice');

    const { value, calls } = await withModelReplies([dailyPlanReply], async () => {
      const response = await jsonPost(
        '/api/agent/daily',
        dailyRequest({ coachId: 'tan-chengyi' }),
        token,
      );
      return { status: response.status, body: (await response.json()) as Json };
    });

    expect(value.status).toBe(200);
    const result = planDailyResponseSchema.parse(value.body);

    expect(result.mode).toBe('daily');
    expect(result.persona.id).toBe('tan-chengyi');
    expect(result.dailyPlan.mainBlocks[0]?.exercises[0]?.name).toBe('卧推');
    expect(Number.isInteger(result.dailyPlan.mainBlocks[0]?.exercises[0]?.sets)).toBe(true);
    expect(result.agentEvents.at(-1)?.type).toBe('final');

    // The persona must actually reach the provider prompt, not just the response.
    const providerMessages = calls[0]?.messages as Array<{ role: string; content: unknown }>;
    const systemText = String(providerMessages.find((message) => message.role === 'system')?.content ?? '');
    expect(systemText).toContain('谭成义');
    expect(systemText).toContain('三分化');

    h.close();
  });

  test('falls back to the generic coach when no coach is requested', async () => {
    const h = createHarness();
    currentHarness = h;
    const token = await registerAndLogin(h, 'daily_bob');

    const { value } = await withModelReplies([dailyPlanReply], async () => {
      const response = await jsonPost('/api/agent/daily', dailyRequest(), token);
      return { status: response.status, body: (await response.json()) as Json };
    });

    expect(value.status).toBe(200);
    const result = planDailyResponseSchema.parse(value.body);
    expect(result.persona.id).toBe('science-muscle');

    h.close();
  });
});

// Day-1 plan (glutes + posterior chain) that passes the deterministic review.
const day1PlanReply = JSON.stringify({
  date: '2026-10-09',
  dayLabel: '第 1 天',
  title: '臀腿力量日',
  focus: '臀部 + 腿后链',
  goal: '用可控重量建立深蹲与臀桥的动作模式',
  intensity: 'medium',
  durationMinutes: 55,
  warmup: ['跑步机 5 分钟快走', '髋部激活与臀桥空杆热身'],
  mainBlocks: [
    {
      title: '主项',
      purpose: '臀部与腿后链',
      exercises: [
        {
          name: '杠铃深蹲',
          sets: 4,
          reps: 8,
          restSeconds: 120,
          intensity: 'RPE 7',
          primaryMuscles: ['腿', '臀'],
          coachingCue: '吸气收紧核心，蹲到能控制的最低点。',
          alternatives: ['臀桥'],
        },
        {
          name: '臀桥',
          sets: 4,
          reps: 12,
          restSeconds: 90,
          intensity: 'RPE 7',
          primaryMuscles: ['臀'],
          coachingCue: '顶峰主动夹臀停一秒，别用腰椎代偿。',
          alternatives: [],
        },
      ],
    },
  ],
  cooldown: ['臀腿拉伸 5 分钟'],
  notes: ['记录深蹲与臀桥的完成重量'],
  coachTips: ['第一天先建立动作模式，臀桥顶峰夹紧再回落。'],
  adaptations: ['首次训练，先不加重量'],
  recoveryWindowHours: 48,
});

// Day-2 plan after the user reports two days of glute soreness: load drops and
// the heavy squat is swapped out, but the session still passes the review.
const day2PlanReply = JSON.stringify({
  date: '2026-10-10',
  dayLabel: '第 2 天',
  title: '低强度上肢 + 臀部维护',
  focus: '背部 + 臀部维持',
  goal: '臀部仍酸痛时降低下肢负荷，保持上肢训练量',
  intensity: 'low',
  durationMinutes: 45,
  warmup: ['跑步机 5 分钟快走', '肩胛激活'],
  mainBlocks: [
    {
      title: '主项',
      purpose: '背部与臀部维持',
      exercises: [
        {
          name: '臀桥',
          sets: 3,
          reps: 12,
          restSeconds: 90,
          intensity: 'RPE 6',
          primaryMuscles: ['臀'],
          coachingCue: '轻重量找臀部发力感，不追求力竭。',
          alternatives: [],
        },
        {
          name: '高位下拉',
          sets: 3,
          reps: 12,
          restSeconds: 90,
          intensity: 'RPE 7',
          primaryMuscles: ['背'],
          coachingCue: '先沉肩再发力，手肘向身体两侧下方走。',
          alternatives: ['坐姿划船'],
        },
        {
          name: '坐姿划船',
          sets: 3,
          reps: 10,
          restSeconds: 90,
          intensity: 'RPE 7',
          primaryMuscles: ['背'],
          coachingCue: '抬胸收肩，先拉肘再回放。',
          alternatives: ['哑铃划船'],
        },
        {
          name: '哑铃弯举',
          sets: 3,
          reps: 12,
          restSeconds: 60,
          intensity: 'RPE 7',
          primaryMuscles: ['手臂'],
          coachingCue: '上臂贴近身体，顶端主动收缩。',
          alternatives: [],
        },
      ],
    },
  ],
  cooldown: ['背部与臀部拉伸 5 分钟'],
  notes: ['臀部酸痛消退前不做大重量深蹲'],
  coachTips: ['你说臀部酸了两天，今天下肢降量降强度，深蹲先停一停。'],
  adaptations: ['把杠铃深蹲换成轻重量臀桥，整体强度降到 low'],
  recoveryWindowHours: 48,
});

describe('daily plan memory across days', () => {
  test('remembers day-1 training and day-2 feedback, then adapts the next day', async () => {
    const h = createHarness();
    currentHarness = h;
    const { token, userId } = await registerAndLoginWithId(h, 'daily_carol');

    const day1Note = '第一天开始练，我的目标是三个月练出翘臀，每周能练三天，晚上只有一小时';
    const day2Note = '昨天深蹲和臀桥练完，屁股酸了两天还没好；昨晚吃了鸡胸肉、米饭和一份西兰花';

    // --- Day 1: plan is generated and the user's goal note is stored as memory. ---
    const { value: day1 } = await withModelReplies([day1PlanReply], async () => {
      const response = await jsonPost(
        '/api/agent/daily',
        dailyRequest({
          user: { id: userId, trainingExperience: 'intermediate', name: 'Carol' },
          goal: { primary: 'muscle_gain', targetAreas: ['臀'], requestNote: day1Note },
        }),
        token,
      );
      return { status: response.status, body: (await response.json()) as Json };
    });

    expect(day1.status).toBe(200);
    const day1Result = planDailyResponseSchema.parse(day1.body);
    expect(day1Result.dailyPlan.intensity).toBe('medium');
    expect(day1Result.dailyPlan.mainBlocks[0]?.exercises.map((e) => e.name)).toContain('臀桥');

    // --- Day 2: the user reports how it felt and what they ate. ---
    const { value: day2, calls } = await withModelReplies([day2PlanReply], async () => {
      const response = await jsonPost(
        '/api/agent/daily',
        dailyRequest({
          user: { id: userId, trainingExperience: 'intermediate', name: 'Carol' },
          goal: { primary: 'muscle_gain', targetAreas: ['臀'], requestNote: day2Note },
          currentState: { soreness: ['臀部酸痛'] },
        }),
        token,
      );
      return { status: response.status, body: (await response.json()) as Json };
    });

    expect(day2.status).toBe(200);
    const day2Result = planDailyResponseSchema.parse(day2.body);

    // Day-1 memory reaches the day-2 provider prompt, which is the only way its
    // text can appear there: it is absent from the day-2 payload.
    const day2Messages = calls[0]?.messages as Array<{ role: string; content: unknown }>;
    const day2PromptText = JSON.stringify(day2Messages);
    expect(day2PromptText).toContain(day1Note);
    expect(day2PromptText).toContain('鸡胸肉');
    expect(day2PromptText).toContain('臀部酸痛');

    // Both days are persisted and readable through the memory API.
    const memoryResponse = await h.app.handle(
      new Request('http://localhost/api/agent/memory/items?limit=50', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(memoryResponse.status).toBe(200);
    const memoryBody = (await memoryResponse.json()) as { items: Array<{ memory: string }> };
    const remembered = memoryBody.items.map((item) => item.memory);
    expect(remembered).toContain(day1Note);
    expect(remembered).toContain(day2Note);

    // The day-2 plan reacts to the soreness and still passes the deterministic review.
    expect(day2Result.review.status).toBe('pass');
    expect(day2Result.dailyPlan.intensity).toBe('low');
    expect(day2Result.dailyPlan.intensity).not.toBe(day1Result.dailyPlan.intensity);

    const day2ExerciseNames = day2Result.dailyPlan.mainBlocks.flatMap((block) =>
      block.exercises.map((exercise) => exercise.name),
    );
    expect(day2ExerciseNames).toContain('臀桥');
    expect(day2ExerciseNames).not.toContain('杠铃深蹲');

    h.close();
  });
});
