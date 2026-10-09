import { describe, expect, test } from 'bun:test';
import {
  buildDailyPlanMessages,
  buildDailyPlanSystemPrompt,
} from '../../planning/prompts/daily-message';
import { buildPlanningSystemPrompt } from '../../planning/prompts/system';
import { DEFAULT_COACH_PERSONA, resolveCoachPersona } from '../../planning/personas';
import { buildProgrammingConstraints } from '../../planning/tools/create-planning-tools';
import { planRequestSchema, type PlanRequestInput } from '../types';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../training-taxonomy';

const buildRequest = (overrides: Partial<PlanRequestInput> = {}): PlanRequestInput =>
  planRequestSchema.parse({
    user: { id: 'prompt-user', trainingExperience: 'intermediate' },
    goal: { primary: 'muscle_gain', targetAreas: ['胸'] },
    schedule: { availableDaysPerWeek: 3, sessionDurationMinutes: 60 },
    ...overrides,
  });

describe('planning system prompt', () => {
  test('defaults to the generic coach and keeps the supported exercise set', () => {
    const prompt = buildPlanningSystemPrompt({ interactionMode: 'plan' });

    expect(prompt).toContain(DEFAULT_COACH_PERSONA.name);
    expect(prompt).toContain(SUPPORTED_EXERCISE_GUIDANCE);
    expect(prompt).toContain('JSON 整数');
  });

  test('injects the selected persona structure and philosophy', () => {
    const prompt = buildPlanningSystemPrompt({
      interactionMode: 'plan',
      persona: resolveCoachPersona('谭成义'),
    });

    expect(prompt).toContain('谭成义');
    expect(prompt).toContain('三分化');
  });

  test('dialog mode still asks for plain-text answers', () => {
    const prompt = buildPlanningSystemPrompt({ interactionMode: 'dialog' });

    expect(prompt).toContain('文字回答');
  });
});

describe('daily plan prompts', () => {
  test('system prompt carries persona voice and the daily contract', () => {
    const prompt = buildDailyPlanSystemPrompt(resolveCoachPersona('心平气和的张老师'));

    expect(prompt).toContain('心平气和的张老师');
    expect(prompt).toContain(SUPPORTED_EXERCISE_GUIDANCE);
    expect(prompt).toContain('只安排一天');
  });

  test('messages keep chat history before the current request', () => {
    const request = buildRequest({
      goal: {
        primary: 'muscle_gain',
        targetAreas: ['胸'],
        secondary: [],
        requestNote: '今天有点累，胸还想练',
      },
      chatHistory: [
        { role: 'user', text: '我想练胸' },
        { role: 'assistant', text: '好，那今天安排推类。' },
      ],
    });

    const messages = buildDailyPlanMessages({
      request,
      persona: DEFAULT_COACH_PERSONA,
      memoryPreview: [],
      programmingConstraints: buildProgrammingConstraints({
        goal: request.goal.primary,
        daysPerWeek: request.schedule.availableDaysPerWeek,
        sessionDurationMinutes: request.schedule.sessionDurationMinutes,
        trainingExperience: request.user.trainingExperience,
        injuries: [],
        limitations: [],
        soreness: [],
      }),
      currentDate: '2026-10-09',
      currentWeekday: '周五',
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ role: 'user', content: '我想练胸' });
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(messages[2]?.role).toBe('user');

    const last = messages[2];
    const parts = Array.isArray(last?.content) ? last.content : [];
    const text = typeof parts[0] === 'object' && parts[0] !== null && 'text' in parts[0]
      ? String((parts[0] as { text: unknown }).text)
      : '';
    expect(text).toContain('2026-10-09');
    expect(text).toContain('今天有点累，胸还想练');
    expect(text).toContain('输出契约');
  });
});
