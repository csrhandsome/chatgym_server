import type { CoachDayTemplate, CoachPersona } from './types';

const bulletList = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');

const renderSampleDay = (day: CoachDayTemplate) => {
  const exercises =
    day.exercises.length > 0
      ? day.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`).join('、')
      : '（有氧或恢复性内容，由你自行补充）';

  return `- ${day.dayLabel}｜${day.focus}：${exercises}`;
};

const renderSampleWeek = (sampleWeek: readonly CoachDayTemplate[]) =>
  sampleWeek.length > 0 ? sampleWeek.map(renderSampleDay).join('\n') : '（无固定课表，按理念自由安排）';

/**
 * Renders a coach persona into a prompt section. Injected into both the weekly
 * planning system prompt and the daily planning prompt so every plan carries the
 * selected coach's philosophy, structure, and voice.
 */
export const buildPersonaPromptSection = (persona: CoachPersona) => `
当前教练人设：${persona.name}（${persona.tagline}）
人设来源：${persona.source}

训练理念（必须体现在方案的目标、动作选择和讲解里）：
${bulletList(persona.philosophy)}

训练结构：
- 分化：${persona.splitStructure}
- 频率：${persona.weeklyFrequencyGuidance}
- 容量：${persona.volumeGuidance}
- 强度：${persona.intensityGuidance}
- 组间休息：${persona.restGuidance}

偏好动作（只能从下方「受支持动作」里选择，不要发明新动作名）：
- 推：${persona.exercisePreferences.push.join('、')}
- 拉：${persona.exercisePreferences.pull.join('、')}
- 腿：${persona.exercisePreferences.legs.join('、')}
- 孤立/手臂：${persona.exercisePreferences.accessory.join('、')}
- 有氧：${persona.exercisePreferences.cardio.join('、')}

讲解语气：
${bulletList(persona.coachingVoice)}

标志性提示（挑选 1-3 条自然地融进 coachingCue、notes 或教练建议，不要整段照抄）：
${bulletList(persona.signatureCues)}

这个教练会避免：
${bulletList(persona.avoid)}

参考课表（仅用于对齐风格、动作搭配与先后顺序，不要照抄组数次数）：
${renderSampleWeek(persona.sampleWeek)}
`.trim();

/** Short one-line persona tag used in response metadata and traces. */
export const describePersona = (persona: CoachPersona) => `${persona.name}（${persona.id}）`;
