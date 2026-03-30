import { tool } from 'ai';
import { z } from 'zod';
import { recommendExercisesFromCatalog } from '../../shared/exercise-catalog';
import type { WorkoutMemoryStore } from '../../shared/workout-memory-store';
import type { PlanRequestInput, ProgrammingConstraint } from '../../shared/types';
import {
  programmingConstraintSchema,
  retrievedMemorySchema,
  trainingExperienceSchema,
  trainingGoalSchema,
} from '../../shared/types';

const getProgrammingConstraints = ({
  goal,
  daysPerWeek,
  sessionDurationMinutes,
  trainingExperience,
  injuries,
  limitations,
  soreness,
}: {
  goal: PlanRequestInput['goal']['primary'];
  daysPerWeek: number;
  sessionDurationMinutes: number;
  trainingExperience: PlanRequestInput['user']['trainingExperience'];
  injuries: string[];
  limitations: string[];
  soreness: string[];
}): ProgrammingConstraint => {
  const baseVolume =
    trainingExperience === 'beginner'
      ? '6-10 hard sets'
      : trainingExperience === 'intermediate'
        ? '8-14 hard sets'
        : '10-18 hard sets';

  const goalSpecificStyles: Record<PlanRequestInput['goal']['primary'], string[]> = {
    fat_loss: ['2-4 strength blocks', '1 conditioning block', 'short rest density work'],
    muscle_gain: ['compound lift first', '2-3 hypertrophy accessory blocks', 'controlled tempo'],
    strength: ['main lift emphasis', 'lower rep top sets', 'longer rest periods'],
    endurance: ['mixed aerobic intervals', 'submaximal strength support', 'repeatable pacing'],
    general_fitness: ['balanced full-body emphasis', 'moderate conditioning finishers'],
    mobility: ['mobility circuits', 'low-load strength', 'breathing and trunk stability'],
    recomp: ['strength-first sequencing', 'moderate accessory volume', 'finish with brief conditioning'],
  };

  const intensityDistribution =
    goal === 'strength'
      ? ['1-2 high-intensity days', 'remaining days medium or low for recovery']
      : goal === 'endurance'
        ? ['mostly low-to-medium intensity', 'at most 1 hard interval day']
        : ['mostly medium intensity', 'at most 2 high-intensity sessions'];

  const guardrails = [
    `Keep most primary muscles within ${baseVolume} per week.`,
    `Stay near ${sessionDurationMinutes} minutes per session and avoid oversized sessions.`,
    daysPerWeek <= 3
      ? 'Favor full-body or upper/lower structures to cover all major patterns.'
      : 'Use a split that avoids hammering the same muscles on back-to-back days.',
  ];

  if (injuries.length > 0 || limitations.length > 0) {
    guardrails.push('Prefer stable variations and pain-free ranges of motion.');
  }

  if (soreness.length > 0) {
    guardrails.push(`Reduce loading on sore areas first: ${soreness.join(', ')}.`);
  }

  return programmingConstraintSchema.parse({
    weeklySetRangePerPrimaryMuscle: baseVolume,
    recommendedSessionStyles: goalSpecificStyles[goal],
    intensityDistribution,
    progressionGuardrails: [
      'Increase load, reps, or density gradually; do not progress every variable at once.',
      'Keep 1-3 reps in reserve on most work unless explicitly marked hard.',
      'If recovery markers fall for multiple days, reduce one set per exercise before adding more.',
    ],
    recoveryGuardrails: guardrails,
  });
};

export const createPlanningTools = (memoryStore: WorkoutMemoryStore) => ({
  searchWorkoutMemory: tool({
    description:
      'Search the user’s previous workout history using exercise names, muscle groups, notes, and recency.',
    inputSchema: z.object({
      userId: z.string().min(1),
      query: z.string().min(1),
      targetMuscles: z.array(z.string()).max(10).default([]),
      limit: z.number().int().min(1).max(8).default(5),
    }),
    execute: async ({ userId, query, targetMuscles, limit }) => ({
      matches: z.array(retrievedMemorySchema).parse(
        memoryStore.searchRelevant(userId, { query, targetMuscles, limit }),
      ),
    }),
  }),
  recommendExercises: tool({
    description:
      'Recommend exercise options from the fixed frontend-supported 13 exercise catalog based on focus, muscles, equipment, and experience.',
    inputSchema: z.object({
      focus: z.string().min(1),
      targetMuscles: z.array(z.string()).max(10).default([]),
      availableEquipment: z.array(z.string()).max(20).default([]),
      avoidExercises: z.array(z.string()).max(20).default([]),
      trainingExperience: trainingExperienceSchema,
      limit: z.number().int().min(1).max(10).default(6),
    }),
    execute: async ({
      focus,
      targetMuscles,
      availableEquipment,
      avoidExercises,
      trainingExperience,
      limit,
    }) => ({
      recommendations: recommendExercisesFromCatalog({
        focus,
        targetMuscles,
        availableEquipment,
        avoidExercises,
        trainingExperience,
        limit,
      }),
    }),
  }),
  getProgrammingConstraints: tool({
    description:
      'Return deterministic programming guardrails for weekly volume, intensity split, progression, and recovery.',
    inputSchema: z.object({
      goal: trainingGoalSchema,
      daysPerWeek: z.number().int().min(1).max(7),
      sessionDurationMinutes: z.number().int().min(20).max(180),
      trainingExperience: trainingExperienceSchema,
      injuries: z.array(z.string()).max(10).default([]),
      limitations: z.array(z.string()).max(10).default([]),
      soreness: z.array(z.string()).max(10).default([]),
    }),
    execute: async ({
      goal,
      daysPerWeek,
      sessionDurationMinutes,
      trainingExperience,
      injuries,
      limitations,
      soreness,
    }) =>
      getProgrammingConstraints({
        goal,
        daysPerWeek,
        sessionDurationMinutes,
        trainingExperience,
        injuries,
        limitations,
        soreness,
      }),
  }),
});

export type PlanningTools = ReturnType<typeof createPlanningTools>;
