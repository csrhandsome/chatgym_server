import { expect, test } from 'bun:test';
import type { PlanRequestInput } from '../types';
import { resolvePlanningInteractionMode } from '../../planning/interaction-mode';

const createBaseRequest = (): PlanRequestInput => ({
  user: {
    id: 'user-1',
    name: 'demo',
    trainingExperience: 'intermediate',
    injuries: [],
    limitations: [],
  },
  goal: {
    primary: 'muscle_gain',
    secondary: [],
    targetAreas: [],
  },
  schedule: {
    availableDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    preferredDays: [],
  },
  preferences: {
    equipment: [],
    preferredExercises: [],
    avoidExercises: [],
    workoutLocation: 'gym',
  },
  currentState: {
    soreness: [],
  },
  inputImages: [],
  rememberedWorkouts: [],
});

test('uses explicit dialog mode when frontend sends mode=dialog', () => {
  expect(
    resolvePlanningInteractionMode({
      ...createBaseRequest(),
      mode: 'dialog',
    }),
  ).toBe('dialog');
});

test('uses explicit dialog mode when frontend enables conversationMode', () => {
  expect(
    resolvePlanningInteractionMode({
      ...createBaseRequest(),
      conversationMode: true,
    }),
  ).toBe('dialog');
});

test('uses minimal tool strategy as a dialog-mode signal', () => {
  expect(
    resolvePlanningInteractionMode({
      ...createBaseRequest(),
      toolStrategy: 'minimal',
    }),
  ).toBe('dialog');
});

test('infers dialog mode for short follow-up style questions', () => {
  const baseRequest = createBaseRequest();

  expect(
    resolvePlanningInteractionMode({
      ...baseRequest,
      goal: {
        ...baseRequest.goal,
        requestNote: '这个计划能不能改一下，把周三换成在家练？',
      },
    }),
  ).toBe('dialog');
});

test('keeps full planning mode for explicit weekly plan requests', () => {
  const baseRequest = createBaseRequest();

  expect(
    resolvePlanningInteractionMode({
      ...baseRequest,
      goal: {
        ...baseRequest.goal,
        requestNote: '给我生成一个四周增肌训练计划',
      },
    }),
  ).toBe('plan');
});
