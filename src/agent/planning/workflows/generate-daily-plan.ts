import { ToolLoopAgent, generateText, stepCountIs } from 'ai';
import type { ServerRuntime } from '../../../runtime';
import {
  createAgentEventRecorder,
  recordAgentStep,
  recordToolCall,
  recordToolError,
  recordToolResult,
  recordWorkflowThinking,
} from '../../shared/agent-events';
import { parseJsonValueFromModelText } from '../../shared/json-output';
import { ensureAgentConfig, resolvePlanningModel } from '../../shared/models';
import { timestampedTrace } from '../../shared/trace';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';
import type {
  AgentConsoleEvent,
  AgentStepTrace,
  DailyPlan,
  PlanDailyResponse,
  PlanRequestInput,
  WorkflowTraceStep,
} from '../../shared/types';
import { dailyPlanSchema, planDailyResponseSchema } from '../../shared/types';
import { analyzeFitnessImages } from '../../vlm/workflows/analyze-fitness-images';
import { resolveCoachPersona, type CoachPersona } from '../personas';
import {
  buildDailyPlanMessages,
  buildDailyPlanSystemPrompt,
  dailyPlanOutputContract,
} from '../prompts/daily-message';
import { reviewDailyPlan } from '../review/review-daily-plan';
import { buildProgrammingConstraints, createPlanningTools } from '../tools/create-planning-tools';
import { clampInteger, intensityMap, sanitizeMainBlocks, toStringList } from './plan-sanitize';

const buildRetrievalQuery = (request: PlanRequestInput) =>
  [
    request.goal.primary,
    ...request.goal.targetAreas,
    ...request.goal.secondary,
    request.goal.requestNote ?? '',
    ...request.preferences.preferredExercises,
  ]
    .filter(Boolean)
    .join(' ');

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * Cap exercises across blocks so a single day never exceeds the frontend-friendly
 * limit of 5 main exercises, dropping empty trailing blocks.
 */
const capExercisesAcrossBlocks = (blocks: unknown, maxTotal: number) => {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const capped: unknown[] = [];
  let remaining = maxTotal;

  for (const block of blocks.slice(0, 3)) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      capped.push(block);
      continue;
    }

    if (remaining <= 0) {
      continue;
    }

    const blockCandidate = block as Record<string, unknown>;
    const exercises = Array.isArray(blockCandidate.exercises)
      ? blockCandidate.exercises.slice(0, remaining)
      : [];

    remaining -= exercises.length;
    capped.push({ ...blockCandidate, exercises });
  }

  return capped;
};

const sanitizeDailyPlanCandidate = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...candidate,
    intensity:
      typeof candidate.intensity === 'string'
        ? (intensityMap[candidate.intensity.trim().toLowerCase()] ?? candidate.intensity)
        : candidate.intensity,
    durationMinutes: clampInteger(candidate.durationMinutes, 15, 180, 60),
    warmup: toStringList(candidate.warmup).slice(0, 6),
    mainBlocks: capExercisesAcrossBlocks(sanitizeMainBlocks(candidate.mainBlocks), 5),
    cooldown: toStringList(candidate.cooldown).slice(0, 6),
    notes: toStringList(candidate.notes).slice(0, 8),
    coachTips: toStringList(candidate.coachTips).slice(0, 8),
    adaptations: toStringList(candidate.adaptations).slice(0, 8),
    recoveryWindowHours: clampInteger(candidate.recoveryWindowHours, 12, 96, 48),
  };
};

const parseDailyPlanText = (text: string, label: string) =>
  dailyPlanSchema.parse(sanitizeDailyPlanCandidate(parseJsonValueFromModelText(text, label)));

const shapeDailyPlan = async ({
  request,
  persona,
  draft,
  review,
  durableMemoryContext,
}: {
  request: PlanRequestInput;
  persona: CoachPersona;
  draft: string;
  review?: ReturnType<typeof reviewDailyPlan>;
  durableMemoryContext?: string;
}) => {
  const result = await generateText({
    model: resolvePlanningModel(),
    temperature: 0.2,
    prompt: `
你正在把${review ? '一份未通过审核' : '一份草稿'}的单日训练计划整理成前端要求的 JSON 结构。

教练人设：${persona.name}（${persona.tagline}）
用户请求：
${JSON.stringify(request, null, 2)}

历史用户事实与偏好（当前请求优先）：
${durableMemoryContext ?? '没有已记住的事实。'}

${review ? `审核发现的问题：\n${JSON.stringify(review, null, 2)}\n` : ''}待处理内容：
${draft}

要求：
- ${review ? '修复审核发现的问题，' : ''}保留原有意图，除非它违反请求或契约。
- 保持教练人设的语气与动作偏好。
- 单次训练最多 3 个区块、主动作合计不超过 5 个，必须有热身和放松。
- 每个动作的 sets、reps、restSeconds 必须是 JSON 整数，禁止 "8-10"、"10-12" 这类区间字符串。
- 有氧动作（跑步机、爬楼机）用 sets=1、reps 表示分钟数（例如 12 分钟写 1x12），并在 coachingCue 写明时长与强度。
- 动作名和替代动作只能取自下方受支持动作。
- 所有面向用户的文字使用简体中文；intensity 严格用 "low"/"medium"/"high"。
- 保留 coachTips 与 adaptations 字段。

受支持动作：
${SUPPORTED_EXERCISE_GUIDANCE}

输出契约：
${dailyPlanOutputContract}

只返回修正后的 JSON 对象。
`.trim(),
  });

  return parseDailyPlanText(result.text, review ? 'daily plan repair' : 'daily plan normalization');
};

type DailyPlanWorkflowInput = {
  runtime: ServerRuntime;
  request: PlanRequestInput;
  requestId?: string;
  onEvent?: (event: AgentConsoleEvent) => void;
  personaId?: string;
};

export const generateDailyPlanResponse = async ({
  runtime,
  request,
  requestId = crypto.randomUUID(),
  onEvent,
  personaId,
}: DailyPlanWorkflowInput): Promise<PlanDailyResponse> => {
  ensureAgentConfig();

  const { emit, events } = createAgentEventRecorder(requestId, onEvent);
  const trace: WorkflowTraceStep[] = [];
  const persona = resolveCoachPersona(personaId ?? request.coachId ?? request.goal.requestNote);

  trace.push(
    timestampedTrace('coach-persona', 'completed', `已选择教练人设：${persona.name}。`, {
      personaId: persona.id,
    }),
  );
  recordWorkflowThinking(emit, {
    stage: 'coach-persona',
    summary: `已选择教练人设：${persona.name}。`,
    output: { personaId: persona.id },
  });

  const storedSessionIds =
    request.rememberedWorkouts.length > 0
      ? await runtime.workoutMemoryStore.storeSessions(request.user.id, request.rememberedWorkouts)
      : [];

  const userInput = request.goal.requestNote;
  const hasUserInput = Boolean(userInput?.trim());
  const storedConversationMemories = userInput?.trim()
    ? await runtime.workoutMemoryStore.rememberConversation(
        request.user.id,
        [{ role: 'user', content: userInput }],
        { sourceId: requestId, source: 'daily_plan_chat' },
      )
    : [];

  trace.push(
    timestampedTrace(
      'memory-ingest',
      hasUserInput ? 'completed' : 'skipped',
      hasUserInput
        ? `已记录用户本次输入，并写入 ${storedSessionIds.length} 条训练记录。`
        : '未收到新的训练记录或对话文本。',
      { storedSessionIds, storedMemoryCount: storedConversationMemories.length },
    ),
  );

  let imageContextSummary: string | null = null;
  let imageContextTask: string | null = null;

  if (request.inputImages.length > 0) {
    const vlmResult = await analyzeFitnessImages({
      runtime,
      request: {
        userId: request.user.id,
        images: request.inputImages,
        prompt: request.visionPrompt ?? 'Analyze the attached images for today’s workout planning context.',
        preferredTask: 'training_plan_context',
      },
      requestId,
      onEvent,
      emitFinalEvent: false,
    });

    events.push(...vlmResult.agentEvents);
    imageContextSummary = vlmResult.summary;
    imageContextTask = vlmResult.task;
  }

  const retrievalQuery = buildRetrievalQuery(request);
  const [retrievedSessions, rememberedFacts] = await Promise.all([
    runtime.workoutMemoryStore.searchRelevant(request.user.id, {
      query: retrievalQuery,
      targetMuscles: request.goal.targetAreas,
      limit: 5,
    }),
    runtime.workoutMemoryStore.searchMemories(request.user.id, retrievalQuery, { limit: 8 }),
  ]);
  const durableMemoryContext = JSON.stringify(rememberedFacts, null, 2);

  const programmingConstraints = buildProgrammingConstraints({
    goal: request.goal.primary,
    daysPerWeek: request.schedule.availableDaysPerWeek,
    sessionDurationMinutes: request.schedule.sessionDurationMinutes,
    trainingExperience: request.user.trainingExperience,
    injuries: request.user.injuries,
    limitations: request.user.limitations,
    soreness: request.currentState?.soreness ?? [],
  });

  const agentSteps: AgentStepTrace[] = [];
  let currentStepNumber: number | undefined;
  let stepEventCursor = events.length;

  const coachAgent = new ToolLoopAgent({
    id: 'daily-coach-agent',
    model: resolvePlanningModel(),
    instructions: buildDailyPlanSystemPrompt(persona),
    tools: createPlanningTools(
      runtime.workoutMemoryStore,
      {
        onToolCall: ({ toolName, toolCallId, input }) => {
          recordToolCall(emit, { stepNumber: currentStepNumber, toolName, toolCallId, input });
        },
        onToolResult: ({ toolName, toolCallId, output }) => {
          recordToolResult(emit, { stepNumber: currentStepNumber, toolName, toolCallId, output });
        },
        onToolError: ({ toolName, toolCallId, error }) => {
          recordToolError(emit, { stepNumber: currentStepNumber, toolName, toolCallId, error });
        },
      },
      request.user.id,
    ),
    temperature: 0.4,
    stopWhen: stepCountIs(2),
    prepareStep: async ({ stepNumber, messages }) => {
      currentStepNumber = stepNumber;
      const firstMessage = messages[0];
      const trimmedMessages =
        messages.length > 12 && firstMessage
          ? { messages: [firstMessage, ...messages.slice(-8)] }
          : {};

      return {
        activeTools: stepNumber === 0 ? ['recommendExercises'] : [],
        ...trimmedMessages,
      };
    },
  });

  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);

  const planningMessages = buildDailyPlanMessages({
    request,
    persona,
    memoryPreview: retrievedSessions,
    programmingConstraints,
    imageContextSummary,
    currentDate,
    currentWeekday: WEEKDAY_LABELS[now.getDay()] ?? '',
  });

  if (rememberedFacts.length > 0) {
    planningMessages.push({
      role: 'user',
      content: `Historical user facts and preferences, with provenance metadata:\n${durableMemoryContext}\n\nUse these as historical context. The current user request takes precedence.`,
    });
  }

  const planningResult = await coachAgent.generate({
    prompt: planningMessages,
    onStepFinish(step) {
      agentSteps.push(
        recordAgentStep(emit, step, {
          emitToolEvents: false,
          preRecordedEvents: events
            .slice(stepEventCursor)
            .filter((event) => event.stepNumber === step.stepNumber),
        }),
      );
      stepEventCursor = events.length;
    },
  });

  let plan: DailyPlan;

  try {
    plan = parseDailyPlanText(planningResult.text, 'daily training plan');
  } catch {
    plan = await shapeDailyPlan({
      request,
      persona,
      draft: planningResult.text,
      durableMemoryContext,
    });

    trace.push(
      timestampedTrace('daily-plan-normalization', 'completed', '已将模型草稿规范化为单日计划结构。'),
    );
  }

  let review = reviewDailyPlan({ request, plan });

  if (review.status === 'needs-repair') {
    plan = await shapeDailyPlan({
      request,
      persona,
      draft: JSON.stringify(plan, null, 2),
      review,
      durableMemoryContext,
    });
    review = reviewDailyPlan({ request, plan });

    trace.push(
      timestampedTrace('daily-plan-repair', 'completed', `已修复当日计划并重新审核，评分 ${review.score}。`, {
        status: review.status,
        issueCount: review.issues.length,
      }),
    );
  } else {
    trace.push(
      timestampedTrace('daily-plan-review', 'completed', `当日计划审核通过，评分 ${review.score}。`),
    );
  }

  const totalSessionsForUser = await runtime.workoutMemoryStore.getUserSessionCount(request.user.id);

  emit({
    type: 'final',
    stage: 'daily-plan-final',
    summary: '当日训练计划生成完成。',
    output: {
      plan,
      persona: { id: persona.id, name: persona.name },
      review,
    },
  });

  return planDailyResponseSchema.parse({
    requestId,
    generatedAt: new Date().toISOString(),
    mode: 'daily',
    persona: { id: persona.id, name: persona.name, tagline: persona.tagline },
    dailyPlan: plan,
    trace,
    agentSteps,
    agentEvents: events,
    memory: { storedSessionIds, retrievedSessions, totalSessionsForUser },
    imageContext: {
      used: request.inputImages.length > 0,
      summary: imageContextSummary,
      task: imageContextTask,
    },
    review,
  });
};
