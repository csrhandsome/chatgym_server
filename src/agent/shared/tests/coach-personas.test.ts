import { describe, expect, test } from 'bun:test';
import {
  COACH_PERSONAS,
  DEFAULT_COACH_ID,
  listCoachPersonas,
  resolveCoachPersona,
} from '../../planning/personas';
import { buildPersonaPromptSection } from '../../planning/personas/prompt';
import { SUPPORTED_EXERCISE_NAMES } from '../training-taxonomy';

const supportedNames = new Set<string>(SUPPORTED_EXERCISE_NAMES);

describe('coach personas', () => {
  test('exposes the preset coaches with unique ids', () => {
    expect(COACH_PERSONAS).toHaveLength(6);

    const ids = COACH_PERSONAS.map((persona) => persona.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('tan-chengyi');
    expect(ids).toContain('zhang-laoshi');
    expect(ids).toContain('luo-xueyang');
    expect(ids).toContain('carina-sitong');
    expect(DEFAULT_COACH_ID).toBe('science-muscle');
  });

  test('only references frontend-supported exercise names', () => {
    for (const persona of COACH_PERSONAS) {
      const presetExercises = [
        ...persona.exercisePreferences.push,
        ...persona.exercisePreferences.pull,
        ...persona.exercisePreferences.legs,
        ...persona.exercisePreferences.accessory,
        ...persona.exercisePreferences.cardio,
        ...persona.sampleWeek.flatMap((day) => day.exercises.map((exercise) => exercise.name)),
      ];

      for (const name of presetExercises) {
        expect(supportedNames.has(name)).toBe(true);
      }
    }
  });

  test('sample week exercises use integer sets and reps', () => {
    for (const persona of COACH_PERSONAS) {
      for (const day of persona.sampleWeek) {
        for (const exercise of day.exercises) {
          expect(Number.isInteger(exercise.sets)).toBe(true);
          expect(Number.isInteger(exercise.reps)).toBe(true);
          expect(exercise.sets).toBeGreaterThanOrEqual(1);
          expect(exercise.reps).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test('resolves by id, display name, alias, and free-text mention', () => {
    expect(resolveCoachPersona('tan-chengyi').id).toBe('tan-chengyi');
    expect(resolveCoachPersona('谭成义').id).toBe('tan-chengyi');
    expect(resolveCoachPersona('心平气和的张老师').id).toBe('zhang-laoshi');
    expect(resolveCoachPersona('张老师').id).toBe('zhang-laoshi');
    expect(resolveCoachPersona('我想按谭成义的三分化练').id).toBe('tan-chengyi');
    expect(resolveCoachPersona('跟着心平气和的张老师练').id).toBe('zhang-laoshi');
    expect(resolveCoachPersona('罗雪阳').id).toBe('luo-xueyang');
    expect(resolveCoachPersona('今天想按罗雪阳的练法练臀腿').id).toBe('luo-xueyang');
    expect(resolveCoachPersona('Carina思潼').id).toBe('carina-sitong');
    expect(resolveCoachPersona('跟着思潼撸铁').id).toBe('carina-sitong');
  });

  test('falls back to the generic persona for empty or unknown input', () => {
    expect(resolveCoachPersona(undefined).id).toBe(DEFAULT_COACH_ID);
    expect(resolveCoachPersona('   ').id).toBe(DEFAULT_COACH_ID);
    expect(resolveCoachPersona('不存在的教练').id).toBe(DEFAULT_COACH_ID);
  });

  test('renders persona context for prompts without inventing exercise names', () => {
    for (const persona of COACH_PERSONAS) {
      const section = buildPersonaPromptSection(persona);

      expect(section).toContain(persona.name);
      expect(section).toContain(persona.splitStructure);
      expect(section).toContain(persona.exercisePreferences.pull[0] ?? '');
    }
  });

  test('lets the model resolve coaches through the requestNote mention', () => {
    // Mentions appear in Chinese chat text, so the long display name must win over
    // the shorter "张老师" alias for the same persona.
    expect(resolveCoachPersona('今天想练练背，张老师你说怎么排').id).toBe('zhang-laoshi');
  });

  test('lists personas with summary metadata for the API', () => {
    const summaries = listCoachPersonas();

    expect(summaries).toHaveLength(COACH_PERSONAS.length);
    for (const summary of summaries) {
      expect(summary.id.length).toBeGreaterThan(0);
      expect(summary.name.length).toBeGreaterThan(0);
      expect(summary.tagline.length).toBeGreaterThan(0);
    }

    expect(summaries.find((summary) => summary.id === DEFAULT_COACH_ID)?.isDefault).toBe(true);
  });
});
