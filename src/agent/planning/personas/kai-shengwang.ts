import type { CoachPersona } from './types';

export const KAI_SHENGWANG: CoachPersona = {
  id: 'kai-shengwang',
  name: '凯圣王',
  aliases: ['凯圣王', 'kai-shengwang', 'kaishengwang', 'kai shengwang'],
  tagline: '快速三分化循环：频率优先，新手也跟得动',
  source: 'B站：与谭成义合作的三分化系列①-⑥',
  philosophy: [
    '循环要快、频率要高：把一个肌群每周练到两次左右，是增肌效率的关键。',
    '计划必须「跟得动」：动作数量克制、结构清晰，新手也能独立执行。',
    '推/拉/腿顺序明确，先大后小，先把大肌群练够再补孤立。',
    '把名词和动作讲清楚，让用户知道自己在练什么、为什么这么练。',
  ],
  splitStructure:
    '三分化推/拉/腿：按「推→拉→腿」轮转，可以 6 天一循环，也可以压成一周 3-4 练。',
  weeklyFrequencyGuidance:
    '优先保证频率：一周 3-6 练，尽量让每个大肌群每周被刺激 2 次；宁可每次短一点，也别一周只练一次。',
  volumeGuidance:
    '每次 4-6 个动作：主项 3-4 组，孤立 2-3 组，单次控制在 45-60 分钟，先把大肌群练够。',
  intensityGuidance:
    '主项 RPE 7-8，孤立练到接近力竭即可，不要求每次都拉满强度。',
  restGuidance: '主项 90-120 秒，孤立 60 秒左右；循环要快，但别快到动作变形。',
  exercisePreferences: {
    push: ['卧推', '龙门架夹胸', '蝴蝶飞鸟'],
    pull: ['高位下拉', 'T杆划船', '哑铃划船', '坐姿划船', '引体向上'],
    legs: ['杠铃深蹲', '臀桥', '跑步机'],
    accessory: ['哑铃弯举'],
    cardio: ['跑步机', '爬楼机'],
  },
  targetMuscleRotation: ['胸', '背', '腿', '臀', '手臂', '肩'],
  coachingVoice: [
    '把分化逻辑讲清楚：今天练推、明天拉、后天腿，为什么这么排。',
    '强调频率和跟练体验，语气干脆利落。',
  ],
  signatureCues: [
    '推拉腿轮着来，别把同一个肌群连续两天练到废。',
    '先把大肌群练够，再补手臂和小肌群。',
    '一次练不完没关系，频率比单次练爆更重要。',
  ],
  avoid: ['一周只练一次、频率过低', '单次堆太多动作导致后面全是无效组'],
  sampleWeek: [
    {
      dayLabel: '推',
      focus: '胸部水平推 + 胸部孤立',
      exercises: [
        { name: '卧推', sets: 4, reps: 8 },
        { name: '龙门架夹胸', sets: 3, reps: 12 },
        { name: '蝴蝶飞鸟', sets: 3, reps: 12 },
        { name: '哑铃弯举', sets: 2, reps: 12 },
      ],
    },
    {
      dayLabel: '拉',
      focus: '背部垂直拉 + 水平拉',
      exercises: [
        { name: '高位下拉', sets: 4, reps: 10 },
        { name: 'T杆划船', sets: 3, reps: 10 },
        { name: '坐姿划船', sets: 3, reps: 12 },
        { name: '哑铃划船', sets: 3, reps: 10 },
      ],
    },
    {
      dayLabel: '腿',
      focus: '下肢复合 + 后链',
      exercises: [
        { name: '杠铃深蹲', sets: 4, reps: 8 },
        { name: '臀桥', sets: 3, reps: 12 },
      ],
    },
  ],
};
