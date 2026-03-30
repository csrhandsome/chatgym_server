import type { PlanRequestInput, PlanReview, TrainingPlan } from '../../shared/types';
import { resolveMuscleGroup, resolveSupportedExerciseName } from '../../shared/training-taxonomy';

const LOW = 'low' as const;
const MEDIUM = 'medium' as const;
const HIGH = 'high' as const;

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
      message: 'weeklyFrequency should match the actual number of planned sessions.',
    });
    score -= 8;
  }

  if (plan.weeklySchedule.length > request.schedule.availableDaysPerWeek) {
    issues.push({
      severity: HIGH,
      code: 'too-many-training-days',
      message: 'The plan uses more training days than the user says are available.',
    });
    score -= 20;
  }

  if (plan.progressionRules.length < 3) {
    issues.push({
      severity: MEDIUM,
      code: 'weak-progression',
      message: 'The plan needs clearer progression rules for future sessions.',
    });
    score -= 8;
  }

  if (plan.recoveryGuidance.length < 2) {
    issues.push({
      severity: MEDIUM,
      code: 'weak-recovery-guidance',
      message: 'The plan should give more explicit recovery guidance.',
    });
    score -= 6;
  }

  for (const session of plan.weeklySchedule) {
    if (session.durationMinutes > request.schedule.sessionDurationMinutes + 15) {
      issues.push({
        severity: MEDIUM,
        code: `session-too-long-${session.dayIndex}`,
        message: `${session.dayLabel} runs longer than the user’s available session length.`,
      });
      score -= 6;
    }

    if (session.warmup.length === 0 || session.cooldown.length === 0) {
      issues.push({
        severity: HIGH,
        code: `missing-prep-${session.dayIndex}`,
        message: `${session.dayLabel} is missing a warmup or cooldown.`,
      });
      score -= 10;
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
        message: `${previous.dayLabel} and ${current.dayLabel} overload similar muscles without enough recovery.`,
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
        message: `${muscle} volume looks high for ${request.user.trainingExperience} level.`,
      });
      score -= 5;
    }
  }

  for (const target of request.goal.targetAreas) {
    const canonicalTarget = resolveMuscleGroup(target) ?? target;
    const sets = muscleVolumes.get(canonicalTarget) ?? 0;

    if (sets < 4) {
      issues.push({
        severity: LOW,
        code: `target-area-light-${normalize(canonicalTarget)}`,
        message: `The requested target area "${target}" is not emphasized much in the final plan.`,
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
      message: 'Knee-sensitive exercises appear in the plan and need a pain-free fallback or reduced depth.',
    });
    score -= 6;
    recommendations.push('Use a pain-free squat depth and lower stair-climber intensity when knees are sensitive.');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['back', 'lower back'])) &&
    exerciseNames.some((name) => ['杠铃深蹲', 'T杆划船', '哑铃划船'].includes(name))
  ) {
    issues.push({
      severity: MEDIUM,
      code: 'back-sensitive-hinge-selection',
      message: 'A back-demanding barbell or unsupported rowing movement is included despite back sensitivity.',
    });
    score -= 6;
    recommendations.push('Prefer 坐姿划船 or lighter 高位下拉 and reduce barbell loading when the lower back is sensitive.');
  }

  if (
    combinedLimitations.some((item) => keywordMatches(item, ['shoulder'])) &&
    exerciseNames.some((name) => ['卧推', '蝴蝶飞鸟', '龙门架夹胸', '引体向上'].includes(name))
  ) {
    issues.push({
      severity: LOW,
      code: 'shoulder-sensitive-pressing',
      message: 'Pressing volume should stay in pain-free ranges because the user reports shoulder sensitivity.',
    });
    score -= 4;
  }

  if (issues.length === 0) {
    recommendations.push('Keep the structure stable for at least one week before making large changes.');
  }

  recommendations.push('Use readiness markers like sleep, soreness, and energy to auto-regulate the next session.');
  recommendations.push('If technique degrades early, reduce load before reducing training frequency.');

  const boundedScore = Math.max(0, Math.min(100, score));

  return {
    score: boundedScore,
    status:
      boundedScore < 85 || issues.some((issue) => issue.severity === HIGH) ? 'needs-repair' : 'pass',
    issues,
    recommendations: [...new Set(recommendations)].slice(0, 12),
  };
};
