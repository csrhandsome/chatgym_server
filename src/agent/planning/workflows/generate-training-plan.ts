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
import type {
  AgentConsoleEvent,
  AgentStepTrace,
  PlanApiResponse,
  PlanningDialogResponse,
  PlanRequestInput,
  TrainingPlan,
  VlmImageInsight,
} from '../../shared/types';
import { planApiResponseSchema, planningDialogResponseSchema, trainingPlanSchema } from '../../shared/types';
import { analyzeFitnessImages } from '../../vlm/workflows/analyze-fitness-images';
import { buildPlanningMessages, planningOutputContract } from '../prompts/user-message';
import { buildPlanningSystemPrompt } from '../prompts/system';
import { reviewTrainingPlan } from '../review/review-training-plan';
import { buildProgrammingConstraints, createPlanningTools } from '../tools/create-planning-tools';
import { resolvePlanningInteractionMode, type PlanningInteractionMode } from '../interaction-mode';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';
import {
  resolveMuscleGroup,
  resolveSupportedExerciseName,
} from '../../shared/training-taxonomy';

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

const DEFAULT_PLANNING_VISION_PROMPT =
  'Analyze the attached images for workout planning context, available equipment, posture, and any obvious constraints.';

const formatFoodCalorieContext = (results: VlmImageInsight[]) => {
  const sections = results.flatMap((item) => {
    const analysis = item.foodAnalysis;

    if (!analysis) {
      return [];
    }

    const detectedFoods =
      analysis.items.length > 0
        ? analysis.items
            .map((food) => {
              const assumptions =
                food.assumptions.length > 0 ? `; assumptions: ${food.assumptions.join(' ')}` : '';

              return `- ${food.name}: ${food.caloriesLow}-${food.caloriesHigh} kcal (${food.portionEstimate}, confidence ${food.confidence}${assumptions})`;
            })
            .join('\n')
        : '- No itemized foods were returned.';

    return [
      [
        `Image ${item.imageIndex + 1}: estimated total ${analysis.totalCaloriesLow}-${analysis.totalCaloriesHigh} kcal.`,
        item.declaredPurpose ? `Declared purpose: ${item.declaredPurpose}` : null,
        item.observations.length > 0 ? `Visual observations: ${item.observations.join(' | ')}` : null,
        `Detected foods:\n${detectedFoods}`,
        analysis.assumptions.length > 0 ? `Shared assumptions: ${analysis.assumptions.join(' ')}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    ];
  });

  return sections.length > 0 ? sections.join('\n\n') : null;
};

const planHorizonMap: Record<string, TrainingPlan['planHorizon']> = {
  '1_week': '1_week',
  '1周': '1_week',
  '一周': '1_week',
  '2_weeks': '2_weeks',
  '2周': '2_weeks',
  '两周': '2_weeks',
  '4_weeks': '4_weeks',
  '4周': '4_weeks',
  '四周': '4_weeks',
};

const intensityMap: Record<string, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  低: 'low',
  低强度: 'low',
  中: 'medium',
  中等: 'medium',
  中等强度: 'medium',
  高: 'high',
  高强度: 'high',
};

const integerStringPattern = /^[+-]?\d+$/;

const clampInteger = (value: unknown, min: number, max: number, fallback: number) => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && integerStringPattern.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
};

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toStringList(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (value && typeof value === 'object') {
    return Object.values(value)
      .flatMap((item) => toStringList(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const toSupportedExerciseList = (value: unknown, limit: number) => {
  const resolved = toStringList(value)
    .map((item) => resolveSupportedExerciseName(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return [...new Set(resolved)].slice(0, limit);
};

const toSupportedMuscleList = (value: unknown, limit: number) => {
  const resolved = toStringList(value)
    .map((item) => resolveMuscleGroup(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return [...new Set(resolved)].slice(0, limit);
};

const sanitizeTrainingPlanCandidate = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const suitabilityCandidate =
    candidate.suitability && typeof candidate.suitability === 'object' && !Array.isArray(candidate.suitability)
      ? (candidate.suitability as Record<string, unknown>)
      : {};

  const suitabilityWhyItFits =
    toStringList(suitabilityCandidate.whyItFits).length > 0
      ? toStringList(suitabilityCandidate.whyItFits)
      : Object.entries(suitabilityCandidate)
          .filter(([key]) => key !== 'riskControls')
          .flatMap(([, entryValue]) => toStringList(entryValue));
  const suitabilityRiskControls =
    toStringList(suitabilityCandidate.riskControls).length > 0
      ? toStringList(suitabilityCandidate.riskControls)
      : [];

  return {
    ...candidate,
    planHorizon:
      typeof candidate.planHorizon === 'string'
        ? (planHorizonMap[candidate.planHorizon.trim()] ?? candidate.planHorizon)
        : candidate.planHorizon,
    suitability: {
      whyItFits: suitabilityWhyItFits,
      riskControls: suitabilityRiskControls,
    },
    weeklySchedule: Array.isArray(candidate.weeklySchedule)
      ? candidate.weeklySchedule.map((session, sessionIndex) => {
          if (!session || typeof session !== 'object' || Array.isArray(session)) {
            return session;
          }

          const sessionCandidate = session as Record<string, unknown>;

          return {
            ...sessionCandidate,
            dayIndex: clampInteger(sessionCandidate.dayIndex, 1, 7, sessionIndex + 1),
            intensity:
              typeof sessionCandidate.intensity === 'string'
                ? (intensityMap[sessionCandidate.intensity.trim().toLowerCase()] ?? sessionCandidate.intensity)
                : sessionCandidate.intensity,
            durationMinutes: clampInteger(sessionCandidate.durationMinutes, 15, 180, 45),
            warmup: toStringList(sessionCandidate.warmup).slice(0, 6),
            mainBlocks: Array.isArray(sessionCandidate.mainBlocks)
              ? sessionCandidate.mainBlocks.map((block) => {
                  if (!block || typeof block !== 'object' || Array.isArray(block)) {
                    return block;
                  }

                  const blockCandidate = block as Record<string, unknown>;

                  return {
                    ...blockCandidate,
                    exercises: Array.isArray(blockCandidate.exercises)
                      ? blockCandidate.exercises.map((exercise) => {
                          if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) {
                            return exercise;
                          }

                          const exerciseCandidate = exercise as Record<string, unknown>;

                          return {
                            ...exerciseCandidate,
                            name:
                              typeof exerciseCandidate.name === 'string'
                                ? (resolveSupportedExerciseName(exerciseCandidate.name) ??
                                  exerciseCandidate.name)
                                : exerciseCandidate.name,
                            sets: clampInteger(exerciseCandidate.sets, 1, 8, 3),
                            reps: clampInteger(exerciseCandidate.reps, 1, 100, 10),
                            restSeconds: clampInteger(exerciseCandidate.restSeconds, 15, 600, 60),
                            primaryMuscles: toSupportedMuscleList(exerciseCandidate.primaryMuscles, 4),
                            alternatives: toSupportedExerciseList(exerciseCandidate.alternatives, 3),
                          };
                        })
                      : [],
                  };
                })
              : [],
            cooldown: toStringList(sessionCandidate.cooldown).slice(0, 6),
            notes: toStringList(sessionCandidate.notes).slice(0, 8),
            recoveryWindowHours: clampInteger(sessionCandidate.recoveryWindowHours, 12, 96, 48),
          };
        })
      : candidate.weeklySchedule,
    progressionRules: toStringList(candidate.progressionRules).slice(0, 8),
    recoveryGuidance: toStringList(candidate.recoveryGuidance).slice(0, 8),
    metricsToTrack: toStringList(candidate.metricsToTrack).slice(0, 8),
    warnings: toStringList(candidate.warnings).slice(0, 8),
  };
};

const parseTrainingPlanText = (text: string, label: string) =>
  trainingPlanSchema.parse(
    sanitizeTrainingPlanCandidate(parseJsonValueFromModelText(text, label)),
  );

const normalizePlanToSchema = async ({
  request,
  rawDraft,
  durableMemoryContext,
  imageContextSummary,
  foodCalorieContext,
  foodCaloriePrompt,
}: {
  request: PlanRequestInput;
  rawDraft: string;
  durableMemoryContext?: string;
  imageContextSummary?: string | null;
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
}) => {
  const result = await generateText({
    model: resolvePlanningModel(),
    temperature: 0.1,
    prompt: `
You are converting a draft workout plan into the exact frontend JSON contract.

User request:
${JSON.stringify(request, null, 2)}

Historical user facts and preferences (current request takes precedence):
${durableMemoryContext ?? 'No remembered facts.'}

Optional image analysis summary:
${imageContextSummary ?? 'No image analysis summary.'}

Optional food calorie context:
${foodCalorieContext ?? 'No food calorie context.'}

Food-related image prompt:
${foodCaloriePrompt ?? 'No food-related image prompt.'}

Draft plan to normalize:
${rawDraft}

Requirements:
- Preserve the draft's intent unless it violates the request or the schema.
- Convert all enum-like values to the exact frontend literals.
- Ensure suitability has only whyItFits and riskControls string arrays.
- Ensure warmup, cooldown, notes, progressionRules, recoveryGuidance, and metricsToTrack are arrays of strings.
- Ensure each exercise's sets and reps are JSON integers.
- Never output range strings such as "8-10" or "10-12" for sets or reps.
- Keep each session concise: usually 2-3 main blocks and no more than 5 total main exercises.
- Keep exercise names and alternatives inside the supported frontend exercise set.
- All human-readable strings must be Simplified Chinese.
- Keep schema-required enum literals exactly as required, including "1_week", "2_weeks", "4_weeks", "low", "medium", and "high".

Supported exercise set:
${SUPPORTED_EXERCISE_GUIDANCE}

Output contract:
${planningOutputContract}

Return only the corrected JSON object.
`.trim(),
  });

  return parseTrainingPlanText(result.text, 'normalized training plan');
};

const repairPlan = async ({
  request,
  originalPlan,
  review,
  durableMemoryContext,
  imageContextSummary,
  foodCalorieContext,
  foodCaloriePrompt,
}: {
  request: PlanRequestInput;
  originalPlan: TrainingPlan;
  review: ReturnType<typeof reviewTrainingPlan>;
  durableMemoryContext?: string;
  imageContextSummary?: string | null;
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
}) => {
  const result = await generateText({
    model: resolvePlanningModel(),
    temperature: 0.2,
    prompt: `
You are repairing a weekly training plan that failed deterministic review checks.

User request:
${JSON.stringify(request, null, 2)}

Historical user facts and preferences (current request takes precedence):
${durableMemoryContext ?? 'No remembered facts.'}

Optional image analysis summary:
${imageContextSummary ?? 'No image analysis summary.'}

Optional food calorie context:
${foodCalorieContext ?? 'No food calorie context.'}

Food-related image prompt:
${foodCaloriePrompt ?? 'No food-related image prompt.'}

Current draft:
${JSON.stringify(originalPlan, null, 2)}

Review findings:
${JSON.stringify(review, null, 2)}

Revise the plan so it:
- fixes the review findings,
- remains realistic for the same schedule and equipment,
- keeps the same response schema,
- uses only the exact supported frontend exercise names listed below,
- uses JSON integers for each exercise's sets and reps,
- never uses range strings such as "8-10" or "10-12" for sets or reps,
- keeps each session concise with usually 2-3 main blocks and no more than 5 total main exercises,
- stays detailed enough for frontend rendering,
- uses Simplified Chinese for all human-readable strings,
- keeps schema-required enum literals exactly as required, including "1_week", "2_weeks", "4_weeks", "low", "medium", and "high".

Supported exercise set:
${SUPPORTED_EXERCISE_GUIDANCE}

Output contract:
${planningOutputContract}

Return only the corrected JSON object.
`.trim(),
  });

  return parseTrainingPlanText(result.text, 'training plan repair');
};

type PlanningWorkflowInput = {
  runtime: ServerRuntime;
  request: PlanRequestInput;
  requestId?: string;
  onEvent?: (event: AgentConsoleEvent) => void;
};

export const generatePlanningResponse = async ({
  runtime,
  request,
  requestId = crypto.randomUUID(),
  onEvent,
  interactionMode: requestedInteractionMode,
}: PlanningWorkflowInput & { interactionMode?: PlanningInteractionMode }): Promise<PlanApiResponse | PlanningDialogResponse> => {
  ensureAgentConfig();

  const { emit, events } = createAgentEventRecorder(requestId, onEvent);
  const trace = [];
  const storedSessionIds =
    request.rememberedWorkouts.length > 0
      ? await runtime.workoutMemoryStore.storeSessions(request.user.id, request.rememberedWorkouts)
      : [];

  trace.push(
    timestampedTrace(
      'memory-ingest',
      request.rememberedWorkouts.length > 0 ? 'completed' : 'skipped',
      request.rememberedWorkouts.length > 0
        ? `已为用户记忆存储 ${storedSessionIds.length} 条训练记录。`
        : '未收到新的训练记录，已跳过记忆写入。',
      request.rememberedWorkouts.length > 0 ? { storedSessionIds } : undefined,
    ),
  );

  recordWorkflowThinking(emit, {
    stage: 'memory-ingest',
    summary:
      request.rememberedWorkouts.length > 0
        ? `已为用户记忆存储 ${storedSessionIds.length} 条训练记录。`
        : '未收到新的训练记录，已跳过记忆写入。',
    output: request.rememberedWorkouts.length > 0 ? { storedSessionIds } : undefined,
  });

  const userInput = request.goal.requestNote;
  const hasUserInput = Boolean(userInput?.trim());
  const storedConversationMemories = userInput?.trim()
    ? await runtime.workoutMemoryStore.rememberConversation(
        request.user.id,
        [{ role: 'user', content: userInput }],
        { sourceId: requestId, source: 'planning_chat' },
      )
    : [];
  trace.push(timestampedTrace(
    'conversation-memory',
    hasUserInput ? 'completed' : 'skipped',
    hasUserInput ? '已将用户本次输入交由记忆服务提取事实与偏好。' : '未提供用户对话文本，已跳过聊天记忆写入。',
    { storedMemoryIds: storedConversationMemories.map((memory) => memory.id) },
  ));
  recordWorkflowThinking(emit, {
    stage: 'conversation-memory',
    summary: hasUserInput ? '已记录用户本次输入中的事实与偏好。' : '未提供用户对话文本，已跳过聊天记忆写入。',
    output: { storedMemoryCount: storedConversationMemories.length },
  });

  const interactionMode = requestedInteractionMode ?? resolvePlanningInteractionMode(request);

  trace.push(
    timestampedTrace(
      'interaction-mode',
      'completed',
      `规划流程已选择${interactionMode === 'dialog' ? '对话' : '计划'}模式。`,
      {
        interactionMode,
        toolBudget: interactionMode === 'dialog' ? 'single-tool' : 'two-tool-max',
      },
    ),
  );

  recordWorkflowThinking(emit, {
    stage: 'interaction-mode',
    summary: `规划流程已选择${interactionMode === 'dialog' ? '对话' : '计划'}模式。`,
    output: {
      interactionMode,
      toolBudget: interactionMode === 'dialog' ? 'single-tool' : 'two-tool-max',
    },
  });

  let imageContextSummary: string | null = null;
  let imageContextTask: string | null = null;
  let imageContextNotes: string[] = [];
  let foodCalorieContext: string | null = null;
  let foodCaloriePrompt: string | null = null;
  const resolvedVisionPrompt = request.visionPrompt ?? DEFAULT_PLANNING_VISION_PROMPT;

  if (request.inputImages.length > 0) {
    const vlmResult = await analyzeFitnessImages({
      runtime,
      request: {
        userId: request.user.id,
        images: request.inputImages,
        prompt: resolvedVisionPrompt,
        preferredTask: 'training_plan_context',
      },
      requestId,
      onEvent,
      emitFinalEvent: false,
    });

    events.push(...vlmResult.agentEvents);

    imageContextSummary = vlmResult.summary;
    imageContextTask = vlmResult.task;
    imageContextNotes = vlmResult.results.flatMap((item) => item.trainingContext);
    foodCalorieContext = formatFoodCalorieContext(vlmResult.results);
    foodCaloriePrompt = foodCalorieContext ? resolvedVisionPrompt : null;

    trace.push(
      timestampedTrace('image-analysis', 'completed', '已在规划前完成独立图像分析。', {
        task: vlmResult.task,
        imageCount: request.inputImages.length,
        includedFoodCalorieContext: Boolean(foodCalorieContext),
      }),
    );

    recordWorkflowThinking(emit, {
      stage: 'image-analysis',
      summary: '已在规划前完成独立图像分析。',
      output: {
        task: vlmResult.task,
        imageCount: request.inputImages.length,
        includedFoodCalorieContext: Boolean(foodCalorieContext),
      },
    });
  } else {
    trace.push(timestampedTrace('image-analysis', 'skipped', '未提供输入图片，已跳过图像分析。'));

    recordWorkflowThinking(emit, {
      stage: 'image-analysis',
      summary: '未提供输入图片，已跳过图像分析。',
    });
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

  trace.push(
    timestampedTrace(
      'memory-retrieval',
      'completed',
      `已检索到 ${retrievedSessions.length} 条相关历史训练记录，用于规划参考。`,
      {
        retrievalQuery,
        rememberedFactCount: rememberedFacts.length,
        topMatches: retrievedSessions.map((item) => ({
          id: item.id,
          completedAt: item.completedAt,
          score: item.score,
        })),
      },
    ),
  );

  recordWorkflowThinking(emit, {
    stage: 'memory-retrieval',
    summary: `已检索到 ${retrievedSessions.length} 条相关历史训练记录，用于规划参考。`,
    output: {
      retrievalQuery,
      rememberedFactCount: rememberedFacts.length,
      topMatches: retrievedSessions.map((item) => ({
        id: item.id,
        completedAt: item.completedAt,
        score: item.score,
      })),
    },
  });

  const programmingConstraints = buildProgrammingConstraints({
    goal: request.goal.primary,
    daysPerWeek: request.schedule.availableDaysPerWeek,
    sessionDurationMinutes: request.schedule.sessionDurationMinutes,
    trainingExperience: request.user.trainingExperience,
    injuries: request.user.injuries,
    limitations: request.user.limitations,
    soreness: request.currentState?.soreness ?? [],
  });

  trace.push(
    timestampedTrace(
      'programming-constraints',
      'completed',
      '已在规划前准备确定性的训练约束。',
      {
        interactionMode,
        weeklySetRangePerPrimaryMuscle: programmingConstraints.weeklySetRangePerPrimaryMuscle,
      },
    ),
  );

  recordWorkflowThinking(emit, {
    stage: 'programming-constraints',
    summary: '已在规划前准备确定性的训练约束。',
    output: {
      interactionMode,
      weeklySetRangePerPrimaryMuscle: programmingConstraints.weeklySetRangePerPrimaryMuscle,
    },
  });

  const agentSteps: AgentStepTrace[] = [];
  let currentStepNumber: number | undefined;
  let stepEventCursor = events.length;
  const plannerAgent = new ToolLoopAgent({
    id: 'training-planner-agent',
    model: resolvePlanningModel(),
    instructions: buildPlanningSystemPrompt({
      interactionMode,
    }),
    tools: createPlanningTools(runtime.workoutMemoryStore, {
      onToolCall: ({ toolName, toolCallId, input }) => {
        recordToolCall(emit, {
          stepNumber: currentStepNumber,
          toolName,
          toolCallId,
          input,
        });
      },
      onToolResult: ({ toolName, toolCallId, output }) => {
        recordToolResult(emit, {
          stepNumber: currentStepNumber,
          toolName,
          toolCallId,
          output,
        });
      },
      onToolError: ({ toolName, toolCallId, error }) => {
        recordToolError(emit, {
          stepNumber: currentStepNumber,
          toolName,
          toolCallId,
          error,
        });
      },
    }, request.user.id),
    temperature: interactionMode === 'dialog' ? 0.25 : 0.35,
    stopWhen: stepCountIs(interactionMode === 'dialog' ? 2 : 3),
    prepareStep: async ({ stepNumber, messages }) => {
      currentStepNumber = stepNumber;
      const trimThreshold = interactionMode === 'dialog' ? 12 : 18;
      const preservedTail = interactionMode === 'dialog' ? 8 : 12;
      const firstMessage = messages[0];
      const trimmedMessages =
        messages.length > trimThreshold && firstMessage
          ? {
              messages: [firstMessage, ...messages.slice(-preservedTail)],
            }
          : {};

      if (interactionMode === 'dialog') {
        if (stepNumber === 0) {
          return {
            activeTools: ['recommendExercises'],
            ...trimmedMessages,
          };
        }

        return {
          activeTools: [],
          ...trimmedMessages,
        };
      }

      if (stepNumber === 0) {
        return {
          activeTools: ['recommendExercises', 'searchWorkoutMemory'],
          ...trimmedMessages,
        };
      }

      if (stepNumber === 1) {
        return {
          activeTools: ['recommendExercises', 'searchWorkoutMemory'],
          ...trimmedMessages,
        };
      }

      return {
        activeTools: [],
        ...trimmedMessages,
      };
    },
  });

  const planningMessages = buildPlanningMessages({
    request,
    interactionMode,
    memoryPreview: retrievedSessions,
    programmingConstraints,
    imageContextSummary,
    imageContextNotes,
    foodCalorieContext,
    foodCaloriePrompt,
  });
  if (rememberedFacts.length > 0) {
    planningMessages.push({
      role: 'user',
      content: `Historical user facts and preferences, with provenance metadata:\n${durableMemoryContext}\n\nUse these as historical context. The current user request takes precedence. Follow the requested ${interactionMode} response format.`,
    });
  }

  const planningResult = await plannerAgent.generate({
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

  if (interactionMode === 'dialog') {
    trace.push(
      timestampedTrace('agent-dialog', 'completed', '已生成对话回复。', {
        totalAgentSteps: agentSteps.length,
      }),
    );
    recordWorkflowThinking(emit, {
      stage: 'agent-dialog',
      summary: '已生成对话回复。',
      output: { totalAgentSteps: agentSteps.length },
    });
    const response = planningDialogResponseSchema.parse({
      mode: 'dialog',
      answer: planningResult.text,
      requestId,
      generatedAt: new Date().toISOString(),
      trace,
      agentSteps,
      agentEvents: events,
      memory: {
        storedSessionIds,
        retrievedSessions,
        totalSessionsForUser: await runtime.workoutMemoryStore.getUserSessionCount(request.user.id),
      },
      imageContext: {
        used: request.inputImages.length > 0,
        summary: imageContextSummary,
        task: imageContextTask,
      },
    });
    emit({
      type: 'final',
      stage: 'dialog-final',
      summary: '对话回复生成完成。',
      output: { mode: response.mode, answer: response.answer, memory: response.memory, imageContext: response.imageContext },
    });
    return { ...response, agentEvents: events };
  }

  trace.push(
    timestampedTrace('agent-planning', 'completed', '规划流程已生成首版训练计划草案。', {
      totalAgentSteps: agentSteps.length,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'agent-planning',
    summary: '规划流程已生成首版训练计划草案。',
    output: {
      totalAgentSteps: agentSteps.length,
    },
  });

  let plan: TrainingPlan;

  try {
    plan = parseTrainingPlanText(planningResult.text, 'training plan');
  } catch {
    plan = await normalizePlanToSchema({
      request,
      rawDraft: planningResult.text,
      durableMemoryContext,
      imageContextSummary,
      foodCalorieContext,
      foodCaloriePrompt,
    });

    trace.push(
      timestampedTrace(
        'plan-normalization',
        'completed',
        '已将模型草案规范化为前端训练计划结构。',
      ),
    );

    recordWorkflowThinking(emit, {
      stage: 'plan-normalization',
      summary: '已将模型草案规范化为前端训练计划结构。',
    });
  }

  let review = reviewTrainingPlan({
    request,
    plan,
  });

  trace.push(
    timestampedTrace('plan-review', 'completed', `确定性审核评分为 ${review.score} 分。`, {
      status: review.status,
      issueCount: review.issues.length,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'plan-review',
    summary: `确定性审核评分为 ${review.score} 分。`,
    output: {
      status: review.status,
      issueCount: review.issues.length,
    },
  });

  if (review.status === 'needs-repair') {
    plan = await repairPlan({
      request,
      originalPlan: plan,
      review,
      durableMemoryContext,
      imageContextSummary,
      foodCalorieContext,
      foodCaloriePrompt,
    });
    review = reviewTrainingPlan({
      request,
      plan,
    });

    trace.push(
      timestampedTrace(
        'plan-repair',
        'completed',
        `已完成计划修复并重新审核，新评分为 ${review.score} 分。`,
        {
          status: review.status,
          issueCount: review.issues.length,
        },
      ),
    );

    recordWorkflowThinking(emit, {
      stage: 'plan-repair',
      summary: `已完成计划修复并重新审核，新评分为 ${review.score} 分。`,
      output: {
        status: review.status,
        issueCount: review.issues.length,
      },
    });
  } else {
    trace.push(
      timestampedTrace('plan-repair', 'skipped', '草案已通过审核，已跳过修复步骤。'),
    );

    recordWorkflowThinking(emit, {
      stage: 'plan-repair',
      summary: '草案已通过审核，已跳过修复步骤。',
    });
  }

  const totalSessionsForUser = await runtime.workoutMemoryStore.getUserSessionCount(request.user.id);

  trace.push(
    timestampedTrace('memory-summary', 'completed', '已整理前端诊断所需的记忆摘要。', {
      totalSessionsForUser,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'memory-summary',
    summary: '已整理前端诊断所需的记忆摘要。',
    output: {
      totalSessionsForUser,
    },
  });

  emit({
    type: 'final',
    stage: 'plan-final',
    summary: '训练计划生成完成。',
    output: {
      plan,
      memory: {
        storedSessionIds,
        retrievedSessions,
        totalSessionsForUser,
      },
      imageContext: {
        used: request.inputImages.length > 0,
        summary: imageContextSummary,
        task: imageContextTask,
      },
      review,
    },
  });

  return planApiResponseSchema.parse({
    requestId,
    generatedAt: new Date().toISOString(),
    plan,
    trace,
    agentSteps,
    agentEvents: events,
    memory: {
      storedSessionIds,
      retrievedSessions,
      totalSessionsForUser,
    },
    imageContext: {
      used: request.inputImages.length > 0,
      summary: imageContextSummary,
      task: imageContextTask,
    },
    review,
  });
};

export const generateTrainingPlan = async (input: PlanningWorkflowInput): Promise<PlanApiResponse> =>
  planApiResponseSchema.parse(await generatePlanningResponse({ ...input, interactionMode: 'plan' }));
