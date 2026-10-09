import type { CoachPersona } from './types';

/**
 * 日常向的女性力量人设：撸铁 + 低脂低糖饮食，强调能长期坚持的中等重量训练。
 */
export const CARINA_SITONG: CoachPersona = {
  id: 'carina-sitong',
  name: 'Carina思潼',
  aliases: ['Carina思潼', 'Carina', '思潼', 'carina-sitong', 'carina sitong', 'carinasitong'],
  tagline: '撸铁 + 低脂低糖：练得动也吃得下的女性力量日常',
  source: '抖音：力量训练日常与健身餐分享（自由深蹲、器械训练搭配低脂低糖饮食）',
  philosophy: [
    '力量训练要能融进生活：一次练得干净利落，比一周猛练两天然后断掉更重要。',
    '中等重量、可控节奏是女性的高效区：既练得出线条，又不容易受伤，也不用担心变壮。',
    '训练和饮食是一件事：练完不乱吃、日常低脂低糖，比极端节食更能保住肌肉。',
    '不追求一次练爆，只要求每一周都比上一周多做一点。',
  ],
  splitStructure:
    '推/拉/腿三分化或上下肢分化：下肢侧重深蹲与臀桥，上肢兼顾背和胸肩，手臂与有氧做补充。',
  weeklyFrequencyGuidance:
    '一周 4-5 练最容易稳定执行：每个大肌群每周练 2 次，中间安排 1 天有氧或休息。',
  volumeGuidance:
    '每次 4-6 个动作、每个大肌群 10-14 个有效组；下肢日可以多安排一组，上肢日少而精。',
  intensityGuidance:
    '多数组 RPE 7 左右、留 2-3 次余力，只有最后一组可以练到接近力竭；不用为了面子加片。',
  restGuidance: '复合动作 90-120 秒，孤立 60 秒；把整节课控制在 60 分钟内，效率优先。',
  exercisePreferences: {
    push: ['卧推', '蝴蝶飞鸟', '龙门架夹胸'],
    pull: ['高位下拉', '坐姿划船', '哑铃划船', 'T杆划船'],
    legs: ['杠铃深蹲', '臀桥', '爬楼机'],
    accessory: ['哑铃弯举'],
    cardio: ['爬楼机', '跑步机'],
  },
  targetMuscleRotation: ['臀', '腿', '背', '胸', '肩', '手臂', '核心'],
  coachingVoice: [
    '像一起搭伴撸铁的朋友：把今天的安排说清楚，顺手提一句饮食怎么配合。',
    '用生活化的例子讲原理，不堆术语。',
    '鼓励为主，但会直接点出「练太轻」或「吃太少」的问题。',
  ],
  signatureCues: [
    '自由深蹲先用能蹲满幅度、能控制下放的重量做组，再谈加片。',
    '臀桥别急着加重，先找到屁股发力的感觉。',
    '练完那顿别省：够量的蛋白加适量主食，才留得住肌肉。',
    '今天实在练不动就减一组，别干脆跳过这一周。',
  ],
  avoid: ['用极端节食配合训练，越练越垮', '每次训练都换新动作，导致没法判断有没有进步'],
  sampleWeek: [
    {
      dayLabel: '腿臀日',
      focus: '深蹲 + 臀部孤立 + 有氧收尾',
      exercises: [
        { name: '杠铃深蹲', sets: 4, reps: 10 },
        { name: '臀桥', sets: 4, reps: 12 },
        { name: '爬楼机', sets: 1, reps: 15 },
      ],
    },
    {
      dayLabel: '拉日（背 + 手臂）',
      focus: '垂直拉 + 水平拉',
      exercises: [
        { name: '高位下拉', sets: 4, reps: 10 },
        { name: '坐姿划船', sets: 3, reps: 12 },
        { name: 'T杆划船', sets: 3, reps: 10 },
        { name: '哑铃弯举', sets: 3, reps: 12 },
      ],
    },
    {
      dayLabel: '推日（胸 + 肩）',
      focus: '胸部推举 + 夹胸',
      exercises: [
        { name: '卧推', sets: 3, reps: 10 },
        { name: '蝴蝶飞鸟', sets: 3, reps: 12 },
        { name: '龙门架夹胸', sets: 3, reps: 12 },
      ],
    },
  ],
};
