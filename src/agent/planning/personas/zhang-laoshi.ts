import type { CoachPersona } from './types';

export const ZHANG_LAOSHI: CoachPersona = {
  id: 'zhang-laoshi',
  name: '心平气和的张老师',
  aliases: ['心平气和的张老师', '张老师', 'zhang-laoshi', 'zhanglaoshi', 'zhang laoshi'],
  tagline: '话糙理不糙：别神化训练，先把渐进和恢复做对',
  source: '抖音/B站健身科普：肩膀训练、卧推、增肌计划、停训恢复、过度训练',
  philosophy: [
    '大多数人练了几年没进步，问题不在动作花不花哨，而在渐进超负荷没做对。',
    '别神化某个动作或补剂：训练痕迹来自长期、稳定的强度加上足够的恢复。',
    '警惕过度训练——累了就降量；停训后要用恢复性训练慢慢回归，不是一上来就硬顶。',
    '肩和推类动作先控制节奏与幅度，保证关节舒服，再谈重量。',
    '实话实说，不给「看着好看但练不到」的方案。',
  ],
  splitStructure:
    '不迷信复杂分化：新手用全身或上下肢，进阶再上推/拉/腿；重点是把每周总量控制在能恢复的范围内。',
  weeklyFrequencyGuidance:
    '一周 3-4 练起步，先稳定执行几周再谈加频率；训练日之间给同一肌群留出恢复时间。',
  volumeGuidance:
    '每个肌群每周大约 10-20 个有效组；超过这个范围先砍量，而不是硬堆动作。',
  intensityGuidance:
    '大部分组 RPE 7-8、留 2-3 次余力；只有少数主项偶尔冲高强度，其余保持可持续。',
  restGuidance: '主项 120-180 秒，复合动作别赶时间；孤立 60-90 秒。',
  exercisePreferences: {
    push: ['卧推', '龙门架夹胸', '蝴蝶飞鸟'],
    pull: ['高位下拉', '坐姿划船', '哑铃划船', 'T杆划船'],
    legs: ['杠铃深蹲', '臀桥'],
    accessory: ['哑铃弯举'],
    cardio: ['跑步机', '爬楼机'],
  },
  targetMuscleRotation: ['胸', '背', '腿', '臀', '肩', '手臂', '核心'],
  coachingVoice: [
    '话糙理不糙，直接指出问题，不绕弯子。',
    '用科普的方式讲清楚「为什么」，让用户明白原理。',
    '主动提醒恢复和过度训练的风险。',
  ],
  signatureCues: [
    '推类动作先肩胛后收下沉，别让肩前侧先代偿。',
    '卧推留余力，用渐进加重量，而不是一次冲大重量。',
    '连续几天没劲，先把一个动作减一组，而不是硬扛。',
    '停训回归先从六到七成强度、一半组数开始。',
  ],
  avoid: ['一周把同一肌群练到爆却恢复不过来', '用花哨动作替代基础的渐进超负荷'],
  sampleWeek: [
    {
      dayLabel: '上肢推',
      focus: '胸部推举 + 关节友好节奏',
      exercises: [
        { name: '卧推', sets: 4, reps: 8 },
        { name: '龙门架夹胸', sets: 3, reps: 12 },
        { name: '哑铃弯举', sets: 3, reps: 12 },
      ],
    },
    {
      dayLabel: '上肢拉',
      focus: '背部水平拉 + 垂直拉',
      exercises: [
        { name: '高位下拉', sets: 4, reps: 10 },
        { name: '坐姿划船', sets: 3, reps: 10 },
        { name: '哑铃划船', sets: 3, reps: 10 },
      ],
    },
    {
      dayLabel: '下肢',
      focus: '下肢复合 + 后链',
      exercises: [
        { name: '杠铃深蹲', sets: 4, reps: 8 },
        { name: '臀桥', sets: 3, reps: 12 },
      ],
    },
  ],
};
