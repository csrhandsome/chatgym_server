export const SUPPORTED_EXERCISE_NAMES = [
  '卧推',
  '哑铃弯举',
  '杠铃深蹲',
  'T杆划船',
  '臀桥',
  '引体向上',
  '高位下拉',
  '哑铃划船',
  '坐姿划船',
  '蝴蝶飞鸟',
  '龙门架夹胸',
  '跑步机',
  '爬楼机',
] as const;

export type SupportedExerciseName = (typeof SUPPORTED_EXERCISE_NAMES)[number];

export const SUPPORTED_MUSCLE_GROUPS = ['胸', '背', '腿', '臀', '有氧', '手臂', '肩', '核心'] as const;
export type SupportedMuscleGroup = (typeof SUPPORTED_MUSCLE_GROUPS)[number];

export const SUPPORTED_EQUIPMENT_LABELS = [
  '杠铃',
  '哑铃',
  '训练凳',
  'T杆',
  '高位下拉器',
  '龙门架',
  '坐姿划船器',
  '蝴蝶机',
  '引体向上架',
  '跑步机',
  '爬楼机',
  '自重',
] as const;
export type SupportedEquipmentLabel = (typeof SUPPORTED_EQUIPMENT_LABELS)[number];

export const SUPPORTED_EXERCISE_GROUPS = {
  strength: [
    '卧推',
    '哑铃弯举',
    '杠铃深蹲',
    'T杆划船',
    '臀桥',
    '引体向上',
    '高位下拉',
    '哑铃划船',
    '坐姿划船',
    '蝴蝶飞鸟',
    '龙门架夹胸',
  ],
  cardio: ['跑步机', '爬楼机'],
} as const satisfies Record<'strength' | 'cardio', readonly SupportedExerciseName[]>;

type AliasDictionary<T extends string> = Record<T, readonly string[]>;

const EXERCISE_ALIASES: AliasDictionary<SupportedExerciseName> = {
  卧推: ['卧推', 'bench press', 'barbell bench press', 'flat bench press', 'chest press'],
  哑铃弯举: ['哑铃弯举', 'dumbbell curl', 'biceps curl', 'curl'],
  杠铃深蹲: ['杠铃深蹲', 'barbell squat', 'back squat', 'squat'],
  T杆划船: ['T杆划船', 'T杠划船', 't bar row', 't-bar row', 'tbar row'],
  臀桥: ['臀桥', '臀推', 'hip bridge', 'hip thrust', 'glute bridge'],
  引体向上: ['引体向上', 'pull-up', 'pull up', 'chin-up', 'chin up'],
  高位下拉: ['高位下拉', 'lat pulldown', 'pulldown', 'wide grip pulldown'],
  哑铃划船: ['哑铃划船', 'dumbbell row', 'one arm row', 'one-arm dumbbell row'],
  坐姿划船: ['坐姿划船', 'seated row', 'cable row', 'machine row'],
  蝴蝶飞鸟: ['蝴蝶飞鸟', 'pec deck fly', 'pec fly', 'machine chest fly', 'butterfly fly'],
  龙门架夹胸: ['龙门架夹胸', '绳索夹胸', 'cable chest fly', 'cable fly', 'cable crossover'],
  跑步机: ['跑步机', 'treadmill', 'incline walk', 'jogging machine'],
  爬楼机: ['爬楼机', '楼梯机', '登阶机', '踏步机', 'stair climber', 'stairmaster', 'stepmill'],
};

const MUSCLE_GROUP_ALIASES: AliasDictionary<SupportedMuscleGroup> = {
  胸: ['胸', '胸部', '胸肌', 'chest', 'pec', 'pecs'],
  背: ['背', '背部', '背肌', '背阔肌', '上背', '中背', 'back', 'lats', 'lat', 'mid back', 'upper back'],
  腿: ['腿', '腿部', '下肢', '大腿', '股四头肌', '股二头肌', '小腿', 'legs', 'leg', 'lower body', 'quadriceps', 'quads', 'hamstrings', 'calves'],
  臀: ['臀', '臀部', '臀肌', '屁股', 'glutes', 'glute', 'gluteus'],
  有氧: ['有氧', '心肺', '耐力', 'cardio', 'conditioning', 'endurance'],
  手臂: ['手臂', '胳膊', '二头', '三头', '肱二头肌', '肱三头肌', 'arms', 'arm', 'biceps', 'bicep', 'triceps', 'tricep'],
  肩: ['肩', '肩部', '三角肌', 'shoulder', 'shoulders', 'delts', 'delt', 'deltoid'],
  核心: ['核心', '腹', '腰腹', 'core', 'abs', 'abdominals', 'trunk'],
};

const EQUIPMENT_ALIASES: AliasDictionary<SupportedEquipmentLabel> = {
  杠铃: ['杠铃', 'barbell', 'olympic bar'],
  哑铃: ['哑铃', 'dumbbell', 'dumbbells'],
  训练凳: ['训练凳', '卧推凳', '平板凳', '可调凳', 'bench', 'adjustable bench'],
  T杆: ['T杆', 'T杠', 't bar', 't-bar', 'tbar'],
  高位下拉器: ['高位下拉器', '高位下拉', 'lat pulldown machine', 'lat pulldown', 'pulldown machine'],
  龙门架: ['龙门架', '绳索器械', '绳索', 'cable machine', 'cable', 'functional trainer'],
  坐姿划船器: ['坐姿划船器', '坐姿划船', 'seated row machine', 'seated row', 'row machine'],
  蝴蝶机: ['蝴蝶机', '飞鸟机', 'pec deck', 'pec-deck', 'butterfly machine'],
  引体向上架: ['引体向上架', '单杠', 'pull-up bar', 'pull up bar', 'chin-up bar', 'chin up bar'],
  跑步机: ['跑步机', 'treadmill'],
  爬楼机: ['爬楼机', '楼梯机', '登阶机', '踏步机', 'stair climber', 'stairmaster', 'stepmill'],
  自重: ['自重', '徒手', 'bodyweight'],
};

const normalizeToken = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');

export const normalizeTrainingToken = normalizeToken;

export const tokenizeTrainingText = (value: string) =>
  normalizeToken(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean);

const matchesAlias = (value: string, alias: string) => {
  const normalizedValue = normalizeToken(value);
  const normalizedAlias = normalizeToken(alias);

  if (!normalizedValue || !normalizedAlias) {
    return false;
  }

  if (normalizedValue === normalizedAlias) {
    return true;
  }

  if (normalizedValue.includes(normalizedAlias) || normalizedAlias.includes(normalizedValue)) {
    return true;
  }

  const valueTokens = tokenizeTrainingText(value);
  const aliasTokens = tokenizeTrainingText(alias);

  return aliasTokens.length > 0 && aliasTokens.every((token) => valueTokens.includes(token));
};

const collectAliasMatches = <T extends string>(value: string, aliases: AliasDictionary<T>): T[] => {
  if (!value.trim()) {
    return [];
  }

  return (Object.entries(aliases) as Array<[T, readonly string[]]>)
    .filter(([, aliasList]) => aliasList.some((alias) => matchesAlias(value, alias)))
    .map(([canonical]) => canonical);
};

export const getSupportedExerciseAliases = (name: SupportedExerciseName) => EXERCISE_ALIASES[name];

export const resolveSupportedExerciseName = (value: string): SupportedExerciseName | null =>
  collectAliasMatches(value, EXERCISE_ALIASES)[0] ?? null;

export const collectSupportedExerciseNames = (value: string): SupportedExerciseName[] =>
  collectAliasMatches(value, EXERCISE_ALIASES);

export const resolveMuscleGroup = (value: string): SupportedMuscleGroup | null =>
  collectAliasMatches(value, MUSCLE_GROUP_ALIASES)[0] ?? null;

export const collectMuscleGroups = (value: string): SupportedMuscleGroup[] =>
  collectAliasMatches(value, MUSCLE_GROUP_ALIASES);

export const resolveEquipmentLabel = (value: string): SupportedEquipmentLabel | null =>
  collectAliasMatches(value, EQUIPMENT_ALIASES)[0] ?? null;

export const collectEquipmentLabels = (value: string): SupportedEquipmentLabel[] =>
  collectAliasMatches(value, EQUIPMENT_ALIASES);

export const SUPPORTED_EXERCISE_GUIDANCE = [
  'Use only these exact frontend-supported exercise names in plans and tool outputs.',
  `力量训练：${SUPPORTED_EXERCISE_GROUPS.strength.join('、')}`,
  `有氧训练：${SUPPORTED_EXERCISE_GROUPS.cardio.join('、')}`,
  '覆盖范围：胸=卧推/蝴蝶飞鸟/龙门架夹胸；背=引体向上/高位下拉/哑铃划船/坐姿划船/T杆划船；腿臀=杠铃深蹲/臀桥；手臂目前只有哑铃弯举（肱二头肌），不要把它当成三头动作，也不要把训练区块命名为「三头」；有氧=跑步机/爬楼机，按分钟计（sets=1，reps=分钟数）。',
].join('\n');
