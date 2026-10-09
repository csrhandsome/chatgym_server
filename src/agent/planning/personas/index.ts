import { CARINA_SITONG } from './carina-sitong';
import { KAI_SHENGWANG } from './kai-shengwang';
import { LUO_XUEYANG } from './luo-xueyang';
import { SCIENCE_MUSCLE } from './science-muscle';
import { TAN_CHENGYI } from './tan-chengyi';
import type { CoachPersona } from './types';
import { ZHANG_LAOSHI } from './zhang-laoshi';

export type { CoachPersona, CoachDayTemplate, CoachExercisePreferences } from './types';

export const COACH_PERSONAS: readonly CoachPersona[] = [
  TAN_CHENGYI,
  KAI_SHENGWANG,
  ZHANG_LAOSHI,
  LUO_XUEYANG,
  CARINA_SITONG,
  SCIENCE_MUSCLE,
];

export const DEFAULT_COACH_ID = SCIENCE_MUSCLE.id;
export const DEFAULT_COACH_PERSONA = SCIENCE_MUSCLE;

const normalizeCoachToken = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, '-');

/**
 * Resolve a coach persona from an explicit id, a display name, an alias, or a
 * free-text mention such as "我想按谭成义的三分化练". Falls back to the generic
 * evidence-based persona so callers never have to handle a null.
 */
export const resolveCoachPersona = (value?: string | null): CoachPersona => {
  if (!value || !value.trim()) {
    return DEFAULT_COACH_PERSONA;
  }

  const normalized = normalizeCoachToken(value);
  const trimmed = value.trim();

  return (
    COACH_PERSONAS.find((persona) => normalizeCoachToken(persona.id) === normalized) ??
    COACH_PERSONAS.find((persona) => normalizeCoachToken(persona.name) === normalized) ??
    COACH_PERSONAS.find((persona) =>
      persona.aliases.some((alias) => normalizeCoachToken(alias) === normalized),
    ) ??
    COACH_PERSONAS.find((persona) =>
      [persona.name, ...persona.aliases].some((candidate) => trimmed.includes(candidate)),
    ) ??
    DEFAULT_COACH_PERSONA
  );
};

export const listCoachPersonas = () =>
  COACH_PERSONAS.map((persona) => ({
    id: persona.id,
    name: persona.name,
    tagline: persona.tagline,
    source: persona.source,
    splitStructure: persona.splitStructure,
    isDefault: persona.id === DEFAULT_COACH_ID,
  }));
