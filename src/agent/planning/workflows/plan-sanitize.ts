import { EXERCISE_LIBRARY } from '../../shared/exercise-catalog';
import { resolveMuscleGroup, resolveSupportedExerciseName } from '../../shared/training-taxonomy';
import type { TrainingPlan } from '../../shared/types';

export const planHorizonMap: Record<string, TrainingPlan['planHorizon']> = {
  '1_week': '1_week',
  '1周': '1_week',
  一周: '1_week',
  '2_weeks': '2_weeks',
  '2周': '2_weeks',
  两周: '2_weeks',
  '4_weeks': '4_weeks',
  '4周': '4_weeks',
  四周: '4_weeks',
};

export const intensityMap: Record<string, 'low' | 'medium' | 'high'> = {
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

export const integerStringPattern = /^[+-]?\d+$/;

export const clampInteger = (value: unknown, min: number, max: number, fallback: number) => {
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

export const toStringList = (value: unknown): string[] => {
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

export const toSupportedExerciseList = (value: unknown, limit: number) => {
  const resolved = toStringList(value)
    .map((item) => resolveSupportedExerciseName(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return [...new Set(resolved)].slice(0, limit);
};

export const toSupportedMuscleList = (value: unknown, limit: number) => {
  const resolved = toStringList(value)
    .map((item) => resolveMuscleGroup(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return [...new Set(resolved)].slice(0, limit);
};

/**
 * Shared exercise-block sanitizer used by both the weekly and daily workflows.
 * Coerces model output into the frontend contract (supported names, integer
 * sets/reps/rest, supported muscle groups) without throwing.
 */
export const sanitizeMainBlocks = (
  value: unknown,
  { maxExercises }: { maxExercises?: number } = {},
) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return block;
    }

    const blockCandidate = block as Record<string, unknown>;
    const rawExercises = Array.isArray(blockCandidate.exercises)
      ? blockCandidate.exercises
      : [];
    const exercises = rawExercises
      .map((exercise) => {
        if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) {
          return exercise;
        }

        const exerciseCandidate = exercise as Record<string, unknown>;
        const name =
          typeof exerciseCandidate.name === 'string'
            ? (resolveSupportedExerciseName(exerciseCandidate.name) ?? exerciseCandidate.name)
            : exerciseCandidate.name;
        const resolvedMuscles = toSupportedMuscleList(exerciseCandidate.primaryMuscles, 4);
        // Fall back to the catalog's muscles when the model omits them or uses an
        // unrecognized name, so the schema-required non-empty array still holds.
        const catalogMuscles = EXERCISE_LIBRARY.find((entry) => entry.name === name)?.primaryMuscles ?? [];

        return {
          ...exerciseCandidate,
          name,
          sets: clampInteger(exerciseCandidate.sets, 1, 8, 3),
          reps: clampInteger(exerciseCandidate.reps, 1, 100, 10),
          restSeconds: clampInteger(exerciseCandidate.restSeconds, 15, 600, 60),
          primaryMuscles: resolvedMuscles.length > 0 ? resolvedMuscles : [...catalogMuscles],
          alternatives: toSupportedExerciseList(exerciseCandidate.alternatives, 3),
        };
      })
      .slice(0, maxExercises ?? Number.POSITIVE_INFINITY);

    return {
      ...blockCandidate,
      exercises,
    };
  });
};
