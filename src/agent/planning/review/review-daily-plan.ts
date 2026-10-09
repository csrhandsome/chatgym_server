import type { DailyPlan, PlanRequestInput, PlanReview } from '../../shared/types';
import { resolveMuscleGroup, resolveSupportedExerciseName } from '../../shared/training-taxonomy';

const LOW = 'low' as const;
const MEDIUM = 'medium' as const;
const HIGH = 'high' as const;

const normalize = (value: string) => value.toLowerCase().trim();

const keywordMatches = (value: string, keywords: string[]) => {
  const haystack = normalize(value);
  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
};

const getExercises = (plan: DailyPlan) =>
  plan.mainBlocks.flatMap((block) => block.exercises.map((exercise) => ({ block, exercise })));

/**
 * Lightweight deterministic review for a single coaching day. Shares the score
 * and status shape with the weekly review so responses stay parallel.
 */
export const reviewDailyPlan = ({
  request,
  plan,
}: {
  request: PlanRequestInput;
  plan: DailyPlan;
}): PlanReview => {
  const issues: PlanReview['issues'] = [];
  const recommendations: string[] = [];
  let score = 100;

  const exercises = getExercises(plan);
  const exerciseCount = exercises.length;
  const exerciseNames = exercises.map(
    ({ exercise }) => resolveSupportedExerciseName(exercise.name) ?? exercise.name,
  );

  if (plan.mainBlocks.length > 3) {
    issues.push({
      severity: MEDIUM,
      code: 'too-many-blocks',
      message: '单日训练区块过多，单次训练应控制在 3 个区块以内。',
    });
    score -= 8;
  }

  if (exerciseCount > 5) {
    issues.push({
      severity: MEDIUM,
      code: 'too-many-exercises',
      message: '单日主动作超过 5 个，建议精简到 5 个以内。',
    });
    score -= 8;
    recommendations.push('把单日主动作控制在 5 个以内，保证每个动作都练到位。');
  }

  if (plan.warmup.length === 0 || plan.cooldown.length === 0) {
    issues.push({
      severity: HIGH,
      code: 'missing-prep',
      message: '当日计划缺少热身或放松。',
    });
    score -= 10;
  }

  if (plan.durationMinutes > request.schedule.sessionDurationMinutes + 15) {
    issues.push({
      severity: MEDIUM,
      code: 'session-too-long',
      message: '当日训练时长超过了用户可接受的单次时长。',
    });
    score -= 6;
  }

  const combinedLimitations = [
    ...request.user.injuries,
    ...request.user.limitations,
    ...request.currentState.soreness,
  ];

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['knee', '膝'])) &&
    exerciseNames.some((name) => ['杠铃深蹲', '爬楼机'].includes(name))
  ) {
    issues.push({
      severity: MEDIUM,
      code: 'knee-sensitive-exercise-selection',
      message: '膝盖敏感时仍安排了深蹲或爬楼机，需要无痛替代或缩小幅度。',
    });
    score -= 6;
    recommendations.push('膝盖不适时，深蹲保持无痛幅度，并降低爬楼机强度。');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['back', 'lower back', '腰'])) &&
    exerciseNames.some((name) => ['杠铃深蹲', 'T杆划船', '哑铃划船'].includes(name))
  ) {
    issues.push({
      severity: MEDIUM,
      code: 'back-sensitive-hinge-selection',
      message: '下背敏感时仍安排了高腰背负荷动作。',
    });
    score -= 6;
    recommendations.push('下背敏感时，优先选择坐姿划船或较轻的高位下拉，并降低杠铃负重。');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['shoulder', '肩'])) &&
    exerciseNames.some((name) => ['卧推', '蝴蝶飞鸟', '龙门架夹胸', '引体向上'].includes(name))
  ) {
    issues.push({
      severity: LOW,
      code: 'shoulder-sensitive-pressing',
      message: '用户肩部敏感，推类动作应控制在无痛范围内。',
    });
    score -= 4;
  }

  const workingMuscles = new Set(
    exercises.flatMap(({ exercise }) =>
      exercise.primaryMuscles.map((muscle) => resolveMuscleGroup(muscle) ?? muscle),
    ),
  );

  if (workingMuscles.size <= 1 && exerciseCount > 2) {
    issues.push({
      severity: LOW,
      code: 'narrow-muscle-focus',
      message: '当日训练只覆盖单一肌群，确认这是有意安排的针对训练。',
    });
    score -= 3;
  }

  if (issues.length === 0) {
    recommendations.push('按当天状态完成即可；如果动作质量提前下降，先降重量再考虑减组。');
  }

  const boundedScore = Math.max(0, Math.min(100, score));

  return {
    score: boundedScore,
    status:
      boundedScore < 85 || issues.some((issue) => issue.severity === HIGH)
        ? 'needs-repair'
        : 'pass',
    issues,
    recommendations: [...new Set(recommendations)].slice(0, 12),
  };
};
