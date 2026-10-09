import type { SupportedExerciseName, SupportedMuscleGroup } from '../../shared/training-taxonomy';

/**
 * A single sample training day lifted from the coach's public programming.
 * Only frontend-supported exercise names may appear here.
 */
export interface CoachDayTemplate {
  readonly dayLabel: string;
  readonly focus: string;
  readonly exercises: ReadonlyArray<{
    readonly name: SupportedExerciseName;
    readonly sets: number;
    readonly reps: number;
  }>;
}

export interface CoachExercisePreferences {
  readonly push: readonly SupportedExerciseName[];
  readonly pull: readonly SupportedExerciseName[];
  readonly legs: readonly SupportedExerciseName[];
  readonly accessory: readonly SupportedExerciseName[];
  readonly cardio: readonly SupportedExerciseName[];
}

/**
 * A selectable coach persona ("skill"). Personas shape plan generation by
 * injecting training philosophy, split structure, volume/intensity guidance,
 * voice, and signature cues into the planning prompts.
 */
export interface CoachPersona {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly tagline: string;
  /** Where the persona's public programming comes from. */
  readonly source: string;
  readonly philosophy: readonly string[];
  readonly splitStructure: string;
  readonly weeklyFrequencyGuidance: string;
  readonly volumeGuidance: string;
  readonly intensityGuidance: string;
  readonly restGuidance: string;
  readonly exercisePreferences: CoachExercisePreferences;
  readonly targetMuscleRotation: readonly SupportedMuscleGroup[];
  readonly coachingVoice: readonly string[];
  readonly signatureCues: readonly string[];
  readonly avoid: readonly string[];
  readonly sampleWeek: readonly CoachDayTemplate[];
}
