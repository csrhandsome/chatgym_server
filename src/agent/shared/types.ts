import { z } from 'zod';
import {
  SUPPORTED_EQUIPMENT_LABELS,
  SUPPORTED_EXERCISE_NAMES,
  SUPPORTED_MUSCLE_GROUPS,
} from './training-taxonomy';

export const trainingExperienceSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export const trainingGoalSchema = z.enum([
  'fat_loss',
  'muscle_gain',
  'strength',
  'endurance',
  'general_fitness',
  'mobility',
  'recomp',
]);
export const sessionIntensitySchema = z.enum(['low', 'medium', 'high']);
export const workoutLocationSchema = z.enum(['gym', 'home', 'hybrid']);
export const workoutSessionTypeSchema = z.enum([
  'strength',
  'hypertrophy',
  'conditioning',
  'mobility',
  'recovery',
  'sports',
  'mixed',
]);
export const supportedExerciseNameSchema = z.enum(SUPPORTED_EXERCISE_NAMES);
export const supportedMuscleGroupSchema = z.enum(SUPPORTED_MUSCLE_GROUPS);
export const supportedEquipmentLabelSchema = z.enum(SUPPORTED_EQUIPMENT_LABELS);

export const planImageInputSchema = z.object({
  image: z.string().min(1),
  purpose: z.string().max(200).optional(),
  detail: z.enum(['auto', 'low', 'high']).default('auto'),
});

export const workoutMemoryInputSchema = z.object({
  sourceId: z.string().min(1).max(120).optional(),
  completedAt: z.string().datetime(),
  sessionType: workoutSessionTypeSchema.default('mixed'),
  durationMinutes: z.number().int().min(10).max(300),
  exerciseNames: z.array(z.string().min(1).max(120)).min(1).max(24),
  muscleGroups: z.array(z.string().min(1).max(80)).max(12).default([]),
  intensity: sessionIntensitySchema.default('medium'),
  goalTag: z.string().min(1).max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export const planRequestSchema = z.object({
  user: z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120).optional(),
    age: z.number().int().min(12).max(100).optional(),
    sex: z.enum(['male', 'female', 'other']).optional(),
    heightCm: z.number().positive().max(260).optional(),
    weightKg: z.number().positive().max(400).optional(),
    trainingExperience: trainingExperienceSchema,
    injuries: z.array(z.string().min(1).max(160)).max(10).default([]),
    limitations: z.array(z.string().min(1).max(160)).max(10).default([]),
  }),
  goal: z.object({
    primary: trainingGoalSchema,
    secondary: z.array(z.string().min(1).max(120)).max(8).default([]),
    targetAreas: z.array(z.string().min(1).max(80)).max(10).default([]),
    requestNote: z.string().max(2000).optional(),
  }),
  schedule: z.object({
    availableDaysPerWeek: z.number().int().min(1).max(7),
    sessionDurationMinutes: z.number().int().min(20).max(180),
    preferredDays: z.array(z.string().min(1).max(40)).max(7).default([]),
  }),
  preferences: z
    .object({
      equipment: z.array(z.string().min(1).max(80)).max(20).default([]),
      preferredExercises: z.array(z.string().min(1).max(120)).max(12).default([]),
      avoidExercises: z.array(z.string().min(1).max(120)).max(12).default([]),
      preferredSplit: z.string().max(120).optional(),
      workoutLocation: workoutLocationSchema.default('gym'),
    })
    .optional()
    .default({
      equipment: [],
      preferredExercises: [],
      avoidExercises: [],
      workoutLocation: 'gym',
    }),
  currentState: z
    .object({
      soreness: z.array(z.string().min(1).max(80)).max(10).default([]),
      energyLevel: z.number().int().min(1).max(10).optional(),
      sleepHours: z.number().min(0).max(24).optional(),
      stressLevel: z.number().int().min(1).max(10).optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional()
    .default({
      soreness: [],
    }),
  inputImages: z.array(planImageInputSchema).max(6).default([]),
  visionPrompt: z.string().max(2000).optional(),
  rememberedWorkouts: z.array(workoutMemoryInputSchema).max(100).default([]),
});

export const exerciseRecommendationSchema = z.object({
  name: supportedExerciseNameSchema,
  focus: z.string(),
  primaryMuscles: z.array(supportedMuscleGroupSchema).min(1).max(4),
  equipment: z.array(supportedEquipmentLabelSchema).min(1).max(6),
  reason: z.string(),
  coachingCue: z.string(),
  caution: z.array(z.string()).max(6).default([]),
});

export const programmingConstraintSchema = z.object({
  weeklySetRangePerPrimaryMuscle: z.string(),
  recommendedSessionStyles: z.array(z.string()).min(1).max(6),
  intensityDistribution: z.array(z.string()).min(1).max(5),
  progressionGuardrails: z.array(z.string()).min(1).max(8),
  recoveryGuardrails: z.array(z.string()).min(1).max(8),
});

export const retrievedMemorySchema = z.object({
  id: z.string(),
  completedAt: z.string().datetime(),
  sessionType: workoutSessionTypeSchema,
  durationMinutes: z.number().int().min(0),
  exerciseNames: z.array(z.string()),
  muscleGroups: z.array(z.string()),
  intensity: sessionIntensitySchema,
  goalTag: z.string().nullable(),
  notes: z.string().nullable(),
  score: z.number(),
  daysAgo: z.number().int().min(0),
  matchedTerms: z.array(z.string()),
});

export const trainingExerciseSchema = z.object({
  name: supportedExerciseNameSchema,
  sets: z.number().int().min(1).max(8),
  reps: z.string().min(1).max(80),
  restSeconds: z.number().int().min(15).max(600),
  intensity: z.string().min(1).max(80),
  tempo: z.string().min(1).max(40).optional(),
  primaryMuscles: z.array(supportedMuscleGroupSchema).min(1).max(4),
  coachingCue: z.string().min(1).max(240),
  alternatives: z.array(supportedExerciseNameSchema).max(3).default([]),
});

export const trainingBlockSchema = z.object({
  title: z.string().min(1).max(120),
  purpose: z.string().min(1).max(240),
  exercises: z.array(trainingExerciseSchema).min(1).max(8),
});

export const trainingSessionSchema = z.object({
  dayIndex: z.number().int().min(1).max(7),
  dayLabel: z.string().min(1).max(80),
  focus: z.string().min(1).max(120),
  goal: z.string().min(1).max(240),
  intensity: sessionIntensitySchema,
  durationMinutes: z.number().int().min(15).max(180),
  warmup: z.array(z.string().min(1).max(160)).min(1).max(6),
  mainBlocks: z.array(trainingBlockSchema).min(1).max(5),
  cooldown: z.array(z.string().min(1).max(160)).min(1).max(6),
  notes: z.array(z.string().min(1).max(200)).min(1).max(8),
  recoveryWindowHours: z.number().int().min(12).max(96),
});

export const trainingPlanSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(240),
  planHorizon: z.enum(['1_week', '2_weeks', '4_weeks']),
  weeklyFrequency: z.number().int().min(1).max(7),
  summary: z.string().min(1).max(2000),
  suitability: z.object({
    whyItFits: z.array(z.string().min(1).max(240)).min(2).max(8),
    riskControls: z.array(z.string().min(1).max(240)).min(1).max(8),
  }),
  weeklySchedule: z.array(trainingSessionSchema).min(1).max(7),
  progressionRules: z.array(z.string().min(1).max(240)).min(3).max(8),
  recoveryGuidance: z.array(z.string().min(1).max(240)).min(2).max(8),
  metricsToTrack: z.array(z.string().min(1).max(160)).min(3).max(8),
  warnings: z.array(z.string().min(1).max(240)).max(8).default([]),
});

export const workflowTraceStepSchema = z.object({
  stage: z.string().min(1).max(80),
  status: z.enum(['completed', 'skipped']),
  timestamp: z.string().datetime(),
  summary: z.string().min(1).max(500),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const agentEventTypeSchema = z.enum([
  'thinking',
  'tool_call',
  'tool_result',
  'text',
  'final',
  'error',
]);

export const agentEventSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  type: agentEventTypeSchema,
  timestamp: z.string().datetime(),
  stage: z.string().min(1).max(80).optional(),
  stepNumber: z.number().int().min(0).optional(),
  toolName: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(3000),
  text: z.string().min(1).max(12000).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
  finishReason: z.string().min(1).max(120).optional(),
});

export const agentToolTraceSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const agentToolResultTraceSchema = z.object({
  name: z.string(),
  success: z.boolean(),
  summary: z.string(),
});

export const agentStepTraceSchema = z.object({
  stepNumber: z.number().int().min(0),
  type: agentEventTypeSchema,
  finishReason: z.string(),
  summary: z.string(),
  toolCalls: z.array(agentToolTraceSchema),
  toolResults: z.array(agentToolResultTraceSchema),
  text: z.string().optional(),
  events: z.array(agentEventSchema).default([]),
});

export const planReviewIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(300),
});

export const planReviewSchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(['pass', 'needs-repair']),
  issues: z.array(planReviewIssueSchema).max(16),
  recommendations: z.array(z.string().min(1).max(240)).max(12),
});

export const memoryAppendRequestSchema = z.object({
  userId: z.string().min(1).max(120),
  sessions: z.array(workoutMemoryInputSchema).min(1).max(100),
});

export const planApiResponseSchema = z.object({
  requestId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  plan: trainingPlanSchema,
  trace: z.array(workflowTraceStepSchema),
  agentSteps: z.array(agentStepTraceSchema),
  agentEvents: z.array(agentEventSchema),
  memory: z.object({
    storedSessionIds: z.array(z.string()),
    retrievedSessions: z.array(retrievedMemorySchema),
    totalSessionsForUser: z.number().int().min(0),
  }),
  imageContext: z
    .object({
      used: z.boolean(),
      summary: z.string().nullable(),
      task: z.string().nullable(),
    })
    .optional(),
  review: planReviewSchema,
});

export const vlmTaskSchema = z.enum([
  'food_calorie_estimate',
  'equipment_question',
  'training_plan_context',
  'movement_form_feedback',
  'general_fitness_qa',
  'unknown',
]);

export const vlmImageClassificationSchema = z.enum([
  'food',
  'equipment',
  'person',
  'movement',
  'gym_space',
  'other',
]);

export const calorieEstimateItemSchema = z.object({
  name: z.string().min(1).max(160),
  portionEstimate: z.string().min(1).max(160),
  caloriesLow: z.number().int().min(0),
  caloriesHigh: z.number().int().min(0),
  confidence: z.enum(['low', 'medium', 'high']),
  assumptions: z.array(z.string().min(1).max(200)).max(4).default([]),
});

export const equipmentKnowledgeSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(120),
  likelyExercises: z.array(z.string().min(1).max(160)).min(1).max(8),
  targetMuscles: z.array(z.string().min(1).max(80)).min(1).max(8),
  safetyNotes: z.array(z.string().min(1).max(200)).max(8),
});

export const vlmImageInsightSchema = z.object({
  imageIndex: z.number().int().min(0),
  declaredPurpose: z.string().nullable(),
  classification: vlmImageClassificationSchema,
  possibleTasks: z.array(vlmTaskSchema).min(1).max(4),
  observations: z.array(z.string().min(1).max(240)).min(1).max(8),
  foodAnalysis: z
    .object({
      items: z.array(calorieEstimateItemSchema).max(12),
      totalCaloriesLow: z.number().int().min(0),
      totalCaloriesHigh: z.number().int().min(0),
      assumptions: z.array(z.string().min(1).max(240)).max(8),
    })
    .nullable(),
  equipmentAnalysis: z
    .object({
      matches: z.array(equipmentKnowledgeSchema).max(10),
      usageGuidance: z.array(z.string().min(1).max(240)).max(8),
    })
    .nullable(),
  trainingContext: z.array(z.string().min(1).max(240)).max(8).default([]),
});

export const vlmAnalyzeRequestSchema = z.object({
  userId: z.string().min(1).max(120).optional(),
  prompt: z.string().max(2000).optional(),
  preferredTask: vlmTaskSchema.optional(),
  images: z.array(planImageInputSchema).min(1).max(6),
});

export const vlmAnalyzeResponseSchema = z.object({
  requestId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  task: vlmTaskSchema,
  summary: z.string().min(1).max(3000),
  results: z.array(vlmImageInsightSchema).min(1).max(6),
  trace: z.array(workflowTraceStepSchema),
  agentSteps: z.array(agentStepTraceSchema),
  agentEvents: z.array(agentEventSchema),
});

export type WorkoutMemoryInput = z.infer<typeof workoutMemoryInputSchema>;
export type PlanImageInput = z.infer<typeof planImageInputSchema>;
export type PlanRequestInput = z.infer<typeof planRequestSchema>;
export type ExerciseRecommendation = z.infer<typeof exerciseRecommendationSchema>;
export type ProgrammingConstraint = z.infer<typeof programmingConstraintSchema>;
export type RetrievedMemory = z.infer<typeof retrievedMemorySchema>;
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;
export type WorkflowTraceStep = z.infer<typeof workflowTraceStepSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentConsoleEvent = z.infer<typeof agentEventSchema>;
export type AgentStepTrace = z.infer<typeof agentStepTraceSchema>;
export type PlanReview = z.infer<typeof planReviewSchema>;
export type MemoryAppendRequest = z.infer<typeof memoryAppendRequestSchema>;
export type PlanApiResponse = z.infer<typeof planApiResponseSchema>;
export type VlmTask = z.infer<typeof vlmTaskSchema>;
export type VlmAnalyzeRequest = z.infer<typeof vlmAnalyzeRequestSchema>;
export type VlmAnalyzeResponse = z.infer<typeof vlmAnalyzeResponseSchema>;
export type VlmImageInsight = z.infer<typeof vlmImageInsightSchema>;
