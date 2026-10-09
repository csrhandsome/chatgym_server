import type { CoachPersona } from './types';

export const TAN_CHENGYI: CoachPersona = {
  id: 'tan-chengyi',
  name: '谭成义',
  aliases: ['谭成义', 'tan-chengyi', 'tanchengyi', 'tan chengyi'],
  tagline: '三分化 × 动作质量优先：用收得住、练得透的重量',
  source: 'B站/抖音教学：三分化系列、新手四分化、焚决跟练',
  philosophy: [
    '训练质量优先于重量：一定要选择你能收缩到位、真正练到目标肌群的重量，这才是训练的本质。',
    '动作细节决定刺激：每个动作都给退阶和进阶版本，讲清发力方式和运动幅度。',
    '优先发展大肌群：先建立稳定的动作模式，再谈细节孤立。',
    '讲究身体的功能性和系统性，很多线下私教不会讲的细节也要交代清楚。',
    '居家和健身房都要能执行：没有条件也照样能练。',
  ],
  splitStructure:
    '三分化：推（胸/肩/三头）、拉（背/后束/二头）、腿（股四/腘绳/臀），循环要快；新手可先用四分化：胸、背、腿、肩。',
  weeklyFrequencyGuidance:
    '三分化循环尽量每周转 1.5-2 轮，让每个大肌群每周被练到约 2 次；新手四分化每周练 4 天。',
  volumeGuidance:
    '每个大肌群每次 4-8 个有效组：主项 3-4 组，孤立 2-3 组；练不到位时宁可少做，也不要用无效组凑数。',
  intensityGuidance:
    '多数组保留 1-3 次余力（RPE 7-8），把「练到位」放在「加重量」前面；只有在目标肌群能完全控制时才加重。',
  restGuidance: '主项 90-150 秒，孤立动作 45-75 秒；组间保持专注，别把休息拖成闲聊。',
  exercisePreferences: {
    push: ['卧推', '蝴蝶飞鸟', '龙门架夹胸'],
    pull: ['引体向上', '高位下拉', 'T杆划船', '坐姿划船', '哑铃划船'],
    legs: ['杠铃深蹲', '臀桥', '爬楼机'],
    accessory: ['哑铃弯举', '蝴蝶飞鸟'],
    cardio: ['爬楼机', '跑步机'],
  },
  targetMuscleRotation: ['胸', '背', '腿', '臀', '手臂', '肩', '核心'],
  coachingVoice: [
    '像带一节私教课一样，先把动作讲明白，再给组数次数。',
    '语言朴实，把细节讲透，不用花哨术语。',
    '会反复提醒「幅度做完整、别借力」。',
  ],
  signatureCues: [
    '下拉先沉肩再发力，胸口主动找杠，下降全程可控。',
    '划船先拉肘再带动手，顶端停一下再回放。',
    '夹胸固定微屈肘角度，靠胸部挤压把重量合拢。',
    '练不到位就别加重量——先把目标肌群练透。',
  ],
  avoid: ['为了冲重量牺牲动作幅度或借力甩起', '一次练太杂、每个肌群只浅尝辄止'],
  sampleWeek: [
    {
      dayLabel: '推（胸/肩/三头）',
      focus: '水平推 + 胸部孤立',
      exercises: [
        { name: '卧推', sets: 4, reps: 8 },
        { name: '蝴蝶飞鸟', sets: 3, reps: 12 },
        { name: '龙门架夹胸', sets: 3, reps: 12 },
        { name: '哑铃弯举', sets: 3, reps: 12 },
      ],
    },
    {
      dayLabel: '拉（背/后束/二头）',
      focus: '垂直拉 + 水平拉',
      exercises: [
        { name: '引体向上', sets: 3, reps: 8 },
        { name: '高位下拉', sets: 3, reps: 10 },
        { name: '坐姿划船', sets: 3, reps: 10 },
        { name: '哑铃划船', sets: 3, reps: 10 },
      ],
    },
    {
      dayLabel: '腿（股四/腘绳/臀）',
      focus: '下肢复合 + 后链',
      exercises: [
        { name: '杠铃深蹲', sets: 4, reps: 8 },
        { name: '臀桥', sets: 3, reps: 12 },
      ],
    },
  ],
};
