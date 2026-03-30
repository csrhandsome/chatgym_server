import type { ExerciseRecommendation } from './types';
import {
  collectEquipmentLabels,
  collectMuscleGroups,
  collectSupportedExerciseNames,
  getSupportedExerciseAliases,
  normalizeTrainingToken,
  resolveSupportedExerciseName,
  tokenizeTrainingText,
  type SupportedEquipmentLabel,
  type SupportedExerciseName,
  type SupportedMuscleGroup,
} from './training-taxonomy';

export interface ExerciseProfile {
  readonly name: SupportedExerciseName;
  readonly aliases: readonly string[];
  readonly focus: string;
  readonly primaryMuscles: SupportedMuscleGroup[];
  readonly secondaryMuscles: SupportedMuscleGroup[];
  readonly equipment: SupportedEquipmentLabel[];
  readonly experience: Array<'beginner' | 'intermediate' | 'advanced'>;
  readonly goalTags: string[];
  readonly coachingCue: string;
  readonly contraindications: string[];
}

export const EXERCISE_LIBRARY: ExerciseProfile[] = [
  {
    name: '卧推',
    aliases: getSupportedExerciseAliases('卧推'),
    focus: '胸部水平推举力量',
    primaryMuscles: ['胸'],
    secondaryMuscles: ['手臂', '肩'],
    equipment: ['杠铃', '训练凳'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['strength', 'muscle_gain', 'recomp'],
    coachingCue: '肩胛后收下沉，杠铃下放到胸中部后稳定推起。',
    contraindications: ['肩前侧疼痛', '胸肩不适'],
  },
  {
    name: '哑铃弯举',
    aliases: getSupportedExerciseAliases('哑铃弯举'),
    focus: '肱二头肌孤立训练',
    primaryMuscles: ['手臂'],
    secondaryMuscles: [],
    equipment: ['哑铃'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '上臂贴近身体，避免借力摆动，顶端主动收缩。',
    contraindications: ['肘部不适'],
  },
  {
    name: '杠铃深蹲',
    aliases: getSupportedExerciseAliases('杠铃深蹲'),
    focus: '下肢复合力量',
    primaryMuscles: ['腿', '臀'],
    secondaryMuscles: ['核心'],
    equipment: ['杠铃'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['strength', 'muscle_gain', 'recomp'],
    coachingCue: '吸气收紧核心，屈髋屈膝同步下蹲，起身时全脚掌发力。',
    contraindications: ['膝部疼痛', '腰背不适'],
  },
  {
    name: 'T杆划船',
    aliases: getSupportedExerciseAliases('T杆划船'),
    focus: '背部厚度与水平拉力',
    primaryMuscles: ['背'],
    secondaryMuscles: ['手臂', '核心'],
    equipment: ['T杆'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['strength', 'muscle_gain', 'recomp'],
    coachingCue: '髋部稳定，手肘向后拉，避免耸肩和借力甩起。',
    contraindications: ['腰背不适'],
  },
  {
    name: '臀桥',
    aliases: getSupportedExerciseAliases('臀桥'),
    focus: '臀部发力与后链力量',
    primaryMuscles: ['臀'],
    secondaryMuscles: ['腿', '核心'],
    equipment: ['杠铃', '训练凳', '自重'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['strength', 'muscle_gain', 'recomp'],
    coachingCue: '上背固定在凳边，顶峰夹臀，不要用腰椎代偿。',
    contraindications: ['髋部顶端不适', '下背疼痛'],
  },
  {
    name: '引体向上',
    aliases: getSupportedExerciseAliases('引体向上'),
    focus: '背部垂直拉力',
    primaryMuscles: ['背'],
    secondaryMuscles: ['手臂', '核心'],
    equipment: ['引体向上架', '自重'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['strength', 'muscle_gain', 'general_fitness'],
    coachingCue: '先沉肩再发力，上拉时胸口主动找杠，下降全程可控。',
    contraindications: ['肩部不适', '肘部不适'],
  },
  {
    name: '高位下拉',
    aliases: getSupportedExerciseAliases('高位下拉'),
    focus: '背部垂直下拉训练',
    primaryMuscles: ['背'],
    secondaryMuscles: ['手臂'],
    equipment: ['高位下拉器', '龙门架'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '下拉时手肘向身体两侧下方走，避免耸肩和猛拉。',
    contraindications: ['肩关节上举疼痛'],
  },
  {
    name: '哑铃划船',
    aliases: getSupportedExerciseAliases('哑铃划船'),
    focus: '单侧背部水平拉',
    primaryMuscles: ['背'],
    secondaryMuscles: ['手臂', '核心'],
    equipment: ['哑铃', '训练凳'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '躯干保持稳定，手肘贴近身体向后拉，顶端停顿一下。',
    contraindications: ['腰背不适'],
  },
  {
    name: '坐姿划船',
    aliases: getSupportedExerciseAliases('坐姿划船'),
    focus: '器械水平拉与背部稳定',
    primaryMuscles: ['背'],
    secondaryMuscles: ['手臂'],
    equipment: ['坐姿划船器', '龙门架'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '抬胸收肩，先拉肘后回放，动作末端不要后仰过多。',
    contraindications: ['急性腰背疼痛'],
  },
  {
    name: '蝴蝶飞鸟',
    aliases: getSupportedExerciseAliases('蝴蝶飞鸟'),
    focus: '胸部孤立夹胸',
    primaryMuscles: ['胸'],
    secondaryMuscles: ['肩'],
    equipment: ['蝴蝶机'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '手肘微屈，动作轨迹稳定，顶端保持胸部主动收缩。',
    contraindications: ['肩前侧紧张'],
  },
  {
    name: '龙门架夹胸',
    aliases: getSupportedExerciseAliases('龙门架夹胸'),
    focus: '绳索夹胸与峰值收缩',
    primaryMuscles: ['胸'],
    secondaryMuscles: ['肩'],
    equipment: ['龙门架'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['muscle_gain', 'general_fitness', 'recomp'],
    coachingCue: '微屈肘固定角度，双手向前内侧夹拢，感受胸部挤压。',
    contraindications: ['肩前侧疼痛'],
  },
  {
    name: '跑步机',
    aliases: getSupportedExerciseAliases('跑步机'),
    focus: '有氧耐力与热量消耗',
    primaryMuscles: ['有氧'],
    secondaryMuscles: ['腿', '臀'],
    equipment: ['跑步机'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['fat_loss', 'endurance', 'general_fitness', 'recovery'],
    coachingCue: '步频均匀，躯干保持直立，速度和坡度逐步上调。',
    contraindications: ['小腿拉伤', '膝部冲击疼痛'],
  },
  {
    name: '爬楼机',
    aliases: getSupportedExerciseAliases('爬楼机'),
    focus: '有氧耐力与臀腿代谢',
    primaryMuscles: ['有氧', '臀'],
    secondaryMuscles: ['腿'],
    equipment: ['爬楼机'],
    experience: ['beginner', 'intermediate', 'advanced'],
    goalTags: ['fat_loss', 'endurance', 'general_fitness'],
    coachingCue: '脚步节奏稳定，身体略前倾但不要压扶手，呼吸保持顺畅。',
    contraindications: ['膝部疼痛', '跟腱不适'],
  },
];

interface ExerciseLookupOptions {
  readonly focus: string;
  readonly targetMuscles: string[];
  readonly availableEquipment: string[];
  readonly avoidExercises: string[];
  readonly trainingExperience: 'beginner' | 'intermediate' | 'advanced';
  readonly limit: number;
}

export const recommendExercisesFromCatalog = ({
  focus,
  targetMuscles,
  availableEquipment,
  avoidExercises,
  trainingExperience,
  limit,
}: ExerciseLookupOptions): ExerciseRecommendation[] => {
  const focusSignals = new Set([
    normalizeTrainingToken(focus),
    ...tokenizeTrainingText(focus),
    ...collectMuscleGroups(focus),
    ...collectEquipmentLabels(focus),
    ...collectSupportedExerciseNames(focus),
  ]);
  const targetSet = new Set(
    targetMuscles.flatMap((value) => {
      const matches = collectMuscleGroups(value);
      return matches.length > 0 ? matches : [normalizeTrainingToken(value)];
    }),
  );
  const equipmentSet = new Set(
    availableEquipment.flatMap((value) => {
      const matches = collectEquipmentLabels(value);
      return matches.length > 0 ? matches : [normalizeTrainingToken(value)];
    }),
  );
  const avoidSet = new Set(
    avoidExercises.map((value) => resolveSupportedExerciseName(value) ?? normalizeTrainingToken(value)),
  );

  return EXERCISE_LIBRARY
    .filter((exercise) => {
      const searchableNames = [exercise.name, ...exercise.aliases].map(normalizeTrainingToken);
      return !searchableNames.some((name) => avoidSet.has(name));
    })
    .filter((exercise) => exercise.experience.includes(trainingExperience))
    .map((exercise) => {
      const exerciseTokens = new Set(
        [
          ...exercise.primaryMuscles,
          ...exercise.secondaryMuscles,
          ...exercise.goalTags,
          ...exercise.equipment,
          exercise.focus,
          exercise.name,
          ...exercise.aliases,
        ].flatMap(tokenizeTrainingText),
      );

      const muscleMatches = exercise.primaryMuscles.filter((muscle) => targetSet.has(muscle));
      const equipmentMatches = exercise.equipment.filter((equipment) => equipmentSet.has(equipment));
      const focusMatches = [...focusSignals].filter((token) => exerciseTokens.has(token));

      const score =
        muscleMatches.length * 4 +
        equipmentMatches.length * 3 +
        focusMatches.length * 2 +
        (equipmentSet.size === 0 ? 1 : 0);

      return {
        exercise,
        score,
        reasonParts: [
          muscleMatches.length > 0 ? `匹配目标部位：${muscleMatches.join('、')}` : '贴合当前训练重点',
          equipmentMatches.length > 0
            ? `匹配可用器械：${equipmentMatches.join('、')}`
            : '在常见健身房配置下可完成',
        ],
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ exercise, reasonParts }) => ({
      name: exercise.name,
      focus: exercise.focus,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      reason: reasonParts.join('；'),
      coachingCue: exercise.coachingCue,
      caution: exercise.contraindications,
    }));
};
