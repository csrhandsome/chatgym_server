import { Output, ToolLoopAgent, generateText, stepCountIs } from 'ai';
import type { ServerRuntime } from '../../../runtime';
import { createAgentEventRecorder, recordAgentStep, recordWorkflowThinking } from '../../shared/agent-events';
import { ensureAgentConfig, resolvePlanningModel } from '../../shared/models';
import { timestampedTrace } from '../../shared/trace';
import type {
  AgentConsoleEvent,
  AgentStepTrace,
  PlanApiResponse,
  PlanRequestInput,
  TrainingPlan,
  VlmImageInsight,
} from '../../shared/types';
import { planApiResponseSchema, trainingPlanSchema } from '../../shared/types';
import { analyzeFitnessImages } from '../../vlm/workflows/analyze-fitness-images';
import { buildPlanningMessages } from '../prompts/user-message';
import { planningSystemPrompt } from '../prompts/system';
import { reviewTrainingPlan } from '../review/review-training-plan';
import { createPlanningTools } from '../tools/create-planning-tools';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';

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

const repairPlan = async ({
  request,
  originalPlan,
  review,
  imageContextSummary,
  foodCalorieContext,
  foodCaloriePrompt,
}: {
  request: PlanRequestInput;
  originalPlan: TrainingPlan;
  review: ReturnType<typeof reviewTrainingPlan>;
  imageContextSummary?: string | null;
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
}) => {
  const { output } = await generateText({
    model: resolvePlanningModel(),
    temperature: 0.2,
    output: Output.object({
      schema: trainingPlanSchema,
    }),
    prompt: `
You are repairing a weekly training plan that failed deterministic review checks.

User request:
${JSON.stringify(request, null, 2)}

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
- stays detailed enough for frontend rendering.

Supported exercise set:
${SUPPORTED_EXERCISE_GUIDANCE}

Return only the corrected structured object.
`.trim(),
  });

  return trainingPlanSchema.parse(output);
};

export const generateTrainingPlan = async ({
  runtime,
  request,
  requestId = crypto.randomUUID(),
  onEvent,
}: {
  runtime: ServerRuntime;
  request: PlanRequestInput;
  requestId?: string;
  onEvent?: (event: AgentConsoleEvent) => void;
}): Promise<PlanApiResponse> => {
  ensureAgentConfig();

  const { emit, events } = createAgentEventRecorder(requestId, onEvent);
  const trace = [];
  const storedSessionIds =
    request.rememberedWorkouts.length > 0
      ? runtime.workoutMemoryStore.storeSessions(request.user.id, request.rememberedWorkouts)
      : [];

  trace.push(
    timestampedTrace(
      'memory-ingest',
      request.rememberedWorkouts.length > 0 ? 'completed' : 'skipped',
      request.rememberedWorkouts.length > 0
        ? `Stored ${storedSessionIds.length} workout sessions for user memory.`
        : 'No new workout sessions were supplied for memory ingestion.',
      request.rememberedWorkouts.length > 0 ? { storedSessionIds } : undefined,
    ),
  );

  recordWorkflowThinking(emit, {
    stage: 'memory-ingest',
    summary:
      request.rememberedWorkouts.length > 0
        ? `Stored ${storedSessionIds.length} workout sessions for user memory.`
        : 'No new workout sessions were supplied for memory ingestion.',
    output: request.rememberedWorkouts.length > 0 ? { storedSessionIds } : undefined,
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
      timestampedTrace('image-analysis', 'completed', 'Ran the dedicated VLM workflow before planning.', {
        task: vlmResult.task,
        imageCount: request.inputImages.length,
        includedFoodCalorieContext: Boolean(foodCalorieContext),
      }),
    );

    recordWorkflowThinking(emit, {
      stage: 'image-analysis',
      summary: 'Ran the dedicated VLM workflow before planning.',
      output: {
        task: vlmResult.task,
        imageCount: request.inputImages.length,
        includedFoodCalorieContext: Boolean(foodCalorieContext),
      },
    });
  } else {
    trace.push(timestampedTrace('image-analysis', 'skipped', 'No input images were provided for VLM analysis.'));

    recordWorkflowThinking(emit, {
      stage: 'image-analysis',
      summary: 'No input images were provided for VLM analysis.',
    });
  }

  const retrievalQuery = buildRetrievalQuery(request);
  const retrievedSessions = runtime.workoutMemoryStore.searchRelevant(request.user.id, {
    query: retrievalQuery,
    targetMuscles: request.goal.targetAreas,
    limit: 5,
  });

  trace.push(
    timestampedTrace(
      'memory-retrieval',
      'completed',
      `Retrieved ${retrievedSessions.length} relevant historical workouts for planning context.`,
      {
        retrievalQuery,
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
    summary: `Retrieved ${retrievedSessions.length} relevant historical workouts for planning context.`,
    output: {
      retrievalQuery,
      topMatches: retrievedSessions.map((item) => ({
        id: item.id,
        completedAt: item.completedAt,
        score: item.score,
      })),
    },
  });

  const agentSteps: AgentStepTrace[] = [];
  const plannerAgent = new ToolLoopAgent({
    id: 'training-planner-agent',
    model: resolvePlanningModel(),
    instructions: planningSystemPrompt,
    tools: createPlanningTools(runtime.workoutMemoryStore),
    output: Output.object({
      schema: trainingPlanSchema,
    }),
    temperature: 0.4,
    stopWhen: stepCountIs(6),
    prepareStep: async ({ stepNumber, messages }) => {
      if (stepNumber === 0) {
        return {
          activeTools: ['searchWorkoutMemory', 'getProgrammingConstraints'],
          toolChoice: 'required',
        };
      }

      if (stepNumber === 1) {
        return {
          activeTools: ['recommendExercises', 'getProgrammingConstraints'],
        };
      }

      if (messages.length > 18) {
        const firstMessage = messages[0];

        if (!firstMessage) {
          return {};
        }

        return {
          messages: [firstMessage, ...messages.slice(-12)],
        };
      }

      return {};
    },
  });

  const planningResult = await plannerAgent.generate({
    prompt: buildPlanningMessages({
      request,
      memoryPreview: retrievedSessions,
      imageContextSummary,
      imageContextNotes,
      foodCalorieContext,
      foodCaloriePrompt,
    }),
    onStepFinish(step) {
      agentSteps.push(recordAgentStep(emit, step));
    },
  });

  trace.push(
    timestampedTrace('agent-planning', 'completed', 'Planning workflow generated an initial structured plan.', {
      totalAgentSteps: agentSteps.length,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'agent-planning',
    summary: 'Planning workflow generated an initial structured plan.',
    output: {
      totalAgentSteps: agentSteps.length,
    },
  });

  let plan = trainingPlanSchema.parse(planningResult.output);
  let review = reviewTrainingPlan({
    request,
    plan,
  });

  trace.push(
    timestampedTrace('plan-review', 'completed', `Deterministic review scored the plan at ${review.score}.`, {
      status: review.status,
      issueCount: review.issues.length,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'plan-review',
    summary: `Deterministic review scored the plan at ${review.score}.`,
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
        `Plan was repaired and re-reviewed. New score: ${review.score}.`,
        {
          status: review.status,
          issueCount: review.issues.length,
        },
      ),
    );

    recordWorkflowThinking(emit, {
      stage: 'plan-repair',
      summary: `Plan was repaired and re-reviewed. New score: ${review.score}.`,
      output: {
        status: review.status,
        issueCount: review.issues.length,
      },
    });
  } else {
    trace.push(
      timestampedTrace('plan-repair', 'skipped', 'Repair step skipped because the draft passed review.'),
    );

    recordWorkflowThinking(emit, {
      stage: 'plan-repair',
      summary: 'Repair step skipped because the draft passed review.',
    });
  }

  const totalSessionsForUser = runtime.workoutMemoryStore.getUserSessionCount(request.user.id);

  trace.push(
    timestampedTrace('memory-summary', 'completed', 'Compiled memory summary for frontend diagnostics.', {
      totalSessionsForUser,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'memory-summary',
    summary: 'Compiled memory summary for frontend diagnostics.',
    output: {
      totalSessionsForUser,
    },
  });

  emit({
    type: 'final',
    stage: 'plan-final',
    summary: 'Training plan generation completed.',
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
