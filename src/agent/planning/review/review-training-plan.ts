import type { PlanRequestInput, PlanReview, TrainingPlan } from '../../shared/types';
import { resolveMuscleGroup, resolveSupportedExerciseName } from '../../shared/training-taxonomy';

const LOW = 'low' as const;
const MEDIUM = 'medium' as const;
const HIGH = 'high' as const;
const experienceLabelMap: Record<PlanRequestInput['user']['trainingExperience'], string> = {
  beginner: '新手',
  intermediate: '中级',
  advanced: '高级',
};

const normalize = (value: string) => value.toLowerCase().trim();

const keywordMatches = (value: string, keywords: string[]) => {
  const haystack = normalize(value);
  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
};

const getExperienceVolumeCap = (experience: PlanRequestInput['user']['trainingExperience']) => {
  switch (experience) {
    case 'beginner':
      return 16;
    case 'intermediate':
      return 22;
    case 'advanced':
      return 28;
  }
};

const getAllExercises = (plan: TrainingPlan) =>
  plan.weeklySchedule.flatMap((session) =>
    session.mainBlocks.flatMap((block) => block.exercises.map((exercise) => ({ session, exercise }))),
  );

const getPrimaryMuscleVolumes = (plan: TrainingPlan) => {
  const volumes = new Map<string, number>();

  for (const { exercise } of getAllExercises(plan)) {
    for (const muscle of exercise.primaryMuscles) {
      const canonicalMuscle = resolveMuscleGroup(muscle) ?? muscle;
      volumes.set(canonicalMuscle, (volumes.get(canonicalMuscle) ?? 0) + exercise.sets);
    }
  }

  return volumes;
};

export const reviewTrainingPlan = ({
  request,
  plan,
}: {
  request: PlanRequestInput;
  plan: TrainingPlan;
}): PlanReview => {
  const issues: PlanReview['issues'] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (plan.weeklyFrequency !== plan.weeklySchedule.length) {
    issues.push({
      severity: MEDIUM,
      code: 'weekly-frequency-mismatch',
      message: 'weeklyFrequency 应与实际安排的训练次数一致。',
    });
    score -= 8;
  }

  if (plan.weeklySchedule.length > request.schedule.availableDaysPerWeek) {
    issues.push({
      severity: HIGH,
      code: 'too-many-training-days',
      message: '计划安排的训练天数超过了用户可用天数。',
    });
    score -= 20;
  }

  if (plan.progressionRules.length < 3) {
    issues.push({
      severity: MEDIUM,
      code: 'weak-progression',
      message: '计划需要更清晰的渐进规则。',
    });
    score -= 8;
  }

  if (plan.recoveryGuidance.length < 2) {
    issues.push({
      severity: MEDIUM,
      code: 'weak-recovery-guidance',
      message: '计划需要更明确的恢复建议。',
    });
    score -= 6;
  }

  for (const session of plan.weeklySchedule) {
    const sessionExerciseCount = session.mainBlocks.reduce(
      (count, block) => count + block.exercises.length,
      0,
    );

    if (session.durationMinutes > request.schedule.sessionDurationMinutes + 15) {
      issues.push({
        severity: MEDIUM,
        code: `session-too-long-${session.dayIndex}`,
        message: `${session.dayLabel} 的训练时长超过了用户可接受的单次时长。`,
      });
      score -= 6;
    }

    if (session.warmup.length === 0 || session.cooldown.length === 0) {
      issues.push({
        severity: HIGH,
        code: `missing-prep-${session.dayIndex}`,
        message: `${session.dayLabel} 缺少热身或冷身。`,
      });
      score -= 10;
    }

    if (session.mainBlocks.length > 3 || sessionExerciseCount > 5) {
      issues.push({
        severity: MEDIUM,
        code: `session-too-busy-${session.dayIndex}`,
        message: `${session.dayLabel} 单次训练的动作或区块过多。`,
      });
      score -= 6;
      recommendations.push(`建议将 ${session.dayLabel} 控制在 2-3 个训练区块、且主动作不超过 5 个。`);
    }
  }

  for (let index = 1; index < plan.weeklySchedule.length; index += 1) {
    const previous = plan.weeklySchedule[index - 1];
    const current = plan.weeklySchedule[index];

    if (!previous || !current) {
      continue;
    }

    const previousMuscles = new Set(
      previous.mainBlocks.flatMap((block) => block.exercises.flatMap((exercise) => exercise.primaryMuscles)),
    );
    const currentMuscles = new Set(
      current.mainBlocks.flatMap((block) => block.exercises.flatMap((exercise) => exercise.primaryMuscles)),
    );
    const overlap = [...currentMuscles].filter((muscle) => previousMuscles.has(muscle));

    if (
      overlap.length >= 2 &&
      previous.intensity !== 'low' &&
      current.intensity !== 'low' &&
      current.dayIndex - previous.dayIndex <= 1
    ) {
      issues.push({
        severity: MEDIUM,
        code: `recovery-overlap-${current.dayIndex}`,
        message: `${previous.dayLabel} 与 ${current.dayLabel} 连续刺激相似肌群，恢复可能不足。`,
      });
      score -= 7;
    }
  }

  const muscleVolumes = getPrimaryMuscleVolumes(plan);
  const volumeCap = getExperienceVolumeCap(request.user.trainingExperience);

  for (const [muscle, sets] of muscleVolumes.entries()) {
    if (sets > volumeCap) {
      issues.push({
        severity: MEDIUM,
        code: `volume-high-${muscle}`,
        message: `${muscle} 的训练量对${experienceLabelMap[request.user.trainingExperience]}用户来说偏高。`,
      });
      score -= 5;
    }
  }

  for (const target of request.goal.targetAreas) {
    const canonicalTarget = resolveMuscleGroup(target);

    if (!canonicalTarget) {
      continue;
    }

    const sets = muscleVolumes.get(canonicalTarget) ?? 0;

    if (sets < 4) {
      issues.push({
        severity: LOW,
        code: `target-area-light-${normalize(canonicalTarget)}`,
        message: `计划对目标部位“${target}”的强调不足。`,
      });
      score -= 3;
    }
  }

  const combinedLimitations = [
    ...request.user.injuries,
    ...request.user.limitations,
    ...request.currentState.soreness,
  ];
  const exerciseNames = getAllExercises(plan).map(
    ({ exercise }) => resolveSupportedExerciseName(exercise.name) ?? exercise.name,
  );

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['knee'])) &&
    exerciseNames.some((name) => ['杠铃深蹲', '爬楼机'].includes(name))
  ) {
    issues.push({
      severity: MEDIUM,
      code: 'knee-sensitive-exercise-selection',
      message: '计划中包含对膝盖敏感用户不够友好的动作，需要无痛替代或缩小动作幅度。',
    });
    score -= 6;
    recommendations.push('膝盖不适时，深蹲应保持无痛幅度，并降低爬楼机强度。');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['back', 'lower back'])) &&
    exerciseNames.some((name) => ['杠铃深蹲', 'T杆划船', '哑铃划船'].includes(name))
  ) {
    issues.push({
      severity: MEDIUM,
      code: 'back-sensitive-hinge-selection',
      message: '在背部敏感情况下，计划中仍包含高腰背负荷或无支撑划船动作。',
    });
    score -= 6;
    recommendations.push('下背敏感时，优先选择坐姿划船或较轻的高位下拉，并降低杠铃负重。');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['shoulder'])) &&
    exerciseNames.some((name) => ['卧推', '蝴蝶飞鸟', '龙门架夹胸', '引体向上'].includes(name))
  ) {
    issues.push({
      severity: LOW,
      code: 'shoulder-sensitive-pressing',
      message: '用户肩部敏感，推类动作训练量应控制在无痛范围内。',
    });
    score -= 4;
  }

  if (issues.length === 0) {
    recommendations.push('建议至少稳定执行一周后，再做较大的结构调整。');
  }

  recommendations.push('用睡眠、酸痛和精力等准备度指标来动态调节下一次训练。');
  recommendations.push('如果动作质量过早下降，先降重量，再考虑减少训练频率。');

  const boundedScore = Math.max(0, Math.min(100, score));

  return {
    score: boundedScore,
    status:
      boundedScore < 85 || issues.some((issue) => issue.severity === HIGH) ? 'needs-repair' : 'pass',
    issues,
    recommendations: [...new Set(recommendations)].slice(0, 12),
  };
};
