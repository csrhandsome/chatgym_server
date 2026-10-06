import { expect, test } from 'bun:test';
import { recommendExercisesFromCatalog } from '../exercise-catalog';
import { trainingPlanSchema } from '../types';

test('recommendExercisesFromCatalog matches supported chest actions for Chinese input', () => {
  const recommendations = recommendExercisesFromCatalog({
    focus: '胸部增肌',
    targetMuscles: ['胸'],
    availableEquipment: ['杠铃', '龙门架'],
    avoidExercises: [],
    trainingExperience: 'intermediate',
    limit: 4,
  });

  expect(recommendations.length).toBeGreaterThan(0);
  expect(recommendations.map((item) => item.name)).toContain('卧推');
  expect(recommendations.map((item) => item.name)).toContain('龙门架夹胸');
});

test('recommendExercisesFromCatalog respects English avoid aliases for supported names', () => {
  const recommendations = recommendExercisesFromCatalog({
    focus: 'chest strength',
    targetMuscles: ['chest'],
    availableEquipment: ['bench', 'barbell'],
    avoidExercises: ['bench press'],
    trainingExperience: 'intermediate',
    limit: 4,
  });

  expect(recommendations.map((item) => item.name)).not.toContain('卧推');
});

test('trainingPlanSchema only accepts frontend-supported exercise names', () => {
  expect(() =>
    trainingPlanSchema.parse({
      title: '测试计划',
      objective: '测试',
      planHorizon: '1_week',
      weeklyFrequency: 1,
      summary: '测试摘要',
      suitability: {
        whyItFits: ['符合器械条件', '符合训练频率'],
        riskControls: ['控制训练量'],
      },
      weeklySchedule: [
        {
          dayIndex: 1,
          dayLabel: '周一',
          focus: '胸部',
          goal: '完成胸部训练',
          intensity: 'medium',
          durationMinutes: 60,
          warmup: ['热身 5 分钟'],
          mainBlocks: [
            {
              title: '主训练',
              purpose: '测试动作约束',
              exercises: [
                {
                  name: 'Bench Press',
                  sets: 4,
                  reps: 8,
                  restSeconds: 90,
                  intensity: 'RPE 7',
                  primaryMuscles: ['胸'],
                  coachingCue: '测试',
                  alternatives: ['卧推'],
                },
              ],
            },
          ],
          cooldown: ['拉伸'],
          notes: ['备注'],
          recoveryWindowHours: 48,
        },
      ],
      progressionRules: ['规则 1', '规则 2', '规则 3'],
      recoveryGuidance: ['恢复 1', '恢复 2'],
      metricsToTrack: ['训练次数', '恢复感受', '完成度'],
      warnings: [],
    }),
  ).toThrow();
});

test('trainingPlanSchema requires integer reps instead of rep ranges', () => {
  expect(() =>
    trainingPlanSchema.parse({
      title: '测试计划',
      objective: '测试',
      planHorizon: '1_week',
      weeklyFrequency: 1,
      summary: '测试摘要',
      suitability: {
        whyItFits: ['符合器械条件', '符合训练频率'],
        riskControls: ['控制训练量'],
      },
      weeklySchedule: [
        {
          dayIndex: 1,
          dayLabel: '周一',
          focus: '胸部',
          goal: '完成胸部训练',
          intensity: 'medium',
          durationMinutes: 60,
          warmup: ['热身 5 分钟'],
          mainBlocks: [
            {
              title: '主训练',
              purpose: '测试次数约束',
              exercises: [
                {
                  name: '卧推',
                  sets: 4,
                  reps: '8-10',
                  restSeconds: 90,
                  intensity: 'RPE 7',
                  primaryMuscles: ['胸'],
                  coachingCue: '测试',
                  alternatives: ['龙门架夹胸'],
                },
              ],
            },
          ],
          cooldown: ['拉伸'],
          notes: ['备注'],
          recoveryWindowHours: 48,
        },
      ],
      progressionRules: ['规则 1', '规则 2', '规则 3'],
      recoveryGuidance: ['恢复 1', '恢复 2'],
      metricsToTrack: ['训练次数', '恢复感受', '完成度'],
      warnings: [],
    }),
  ).toThrow();
});
