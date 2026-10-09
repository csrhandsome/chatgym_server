import type { ModelMessage } from 'ai';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';
import type { PlanRequestInput, ProgrammingConstraint, RetrievedMemory } from '../../shared/types';
import type { CoachPersona } from '../personas';
import { buildPersonaPromptSection } from '../personas/prompt';

export const dailyPlanOutputContract = `
Return only one JSON object. Do not wrap it in markdown fences.

Language requirements:
- All human-readable strings must be in Simplified Chinese.
- Keep the enum literals exactly as required: intensity is one of "low", "medium", "high".

Required top-level fields:
- date: "YYYY-MM-DD" (echo the provided current date unless the user asked for another day)
- dayLabel
- title
- focus
- goal
- intensity: "low" | "medium" | "high"
- durationMinutes: integer
- warmup: string[]
- mainBlocks: array with at most 3 blocks
- cooldown: string[]
- notes: string[]
- coachTips: string[]
- adaptations: string[]
- recoveryWindowHours: integer between 12 and 96

Block and exercise shape:
- Each main block must contain title, purpose, exercises.
- Each exercise must contain name, sets, reps, restSeconds, intensity, primaryMuscles, coachingCue, alternatives.
- sets, reps, and restSeconds must be JSON integers. Never output range strings such as "8-10" or "10-12".
- At most 5 exercises in total across all main blocks.
- Exercise name and alternatives must use only the supported frontend exercise names listed below.
`.trim();

export const buildDailyPlanSystemPrompt = (persona: CoachPersona) => `
你是一位资深健身教练，正在和用户一对一聊天，并给出「今天/某一天」的训练计划。像私教一样说人话、给具体安排，而不是罗列规则。

${buildPersonaPromptSection(persona)}

你的工作方式：
1. 读懂用户当前的聊天内容与前端 payload（目标、时长、器械、经验、伤病、当前状态）。
2. 优先使用 payload、历史训练预览、确定性编程约束和记忆，只有确实不足时才调用工具（最多一次）。
3. 结合用户今天的状态（酸痛、精力、睡眠）调整强度与容量；状态差就降量，别硬顶。
4. 只安排一天的训练，不要把整周计划塞进来。
5. 最终只返回一个 JSON 对象。

硬性要求：
- 单次训练最多 3 个训练区块、主动作合计不超过 5 个；必须有热身和放松。
- 组数、次数、休息秒数都必须是 JSON 整数，不要出现 "8-10" 这类区间字符串。
- 有氧动作（跑步机、爬楼机）没有次数概念：用 sets=1、reps 表示计划分钟数（例如 12 分钟写 1x12），并在 coachingCue 里写明时长与强度。
- 动作名和替代动作只能取自下方「受支持动作」。
- 所有面向用户的文字使用简体中文；intensity 严格用 "low"/"medium"/"high"。
- coachTips 要体现当前教练的语气和标志性提示；adaptations 说明根据今天状态做的调整。
- 不要把最终 JSON 包在 markdown 代码块里。

受支持动作（只能从这里选择）：
${SUPPORTED_EXERCISE_GUIDANCE}
`.trim();

export const buildDailyPlanMessages = ({
  request,
  persona,
  memoryPreview,
  programmingConstraints,
  imageContextSummary,
  foodCalorieContext,
  foodCaloriePrompt,
  currentDate,
  currentWeekday,
}: {
  request: PlanRequestInput;
  persona: CoachPersona;
  memoryPreview: RetrievedMemory[];
  programmingConstraints: ProgrammingConstraint;
  imageContextSummary?: string | null;
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
  currentDate: string;
  currentWeekday: string;
}): ModelMessage[] => {
  const { chatHistory = [], ...currentRequest } = request;
  const historyMessages: ModelMessage[] = chatHistory.map(({ role, text }) => ({
    role,
    content: text,
  }));

  const text = `
请根据下面的聊天上下文，为用户安排一天的训练。

当前日期：${currentDate}（${currentWeekday}）
教练人设：${persona.name}

用户当前说的话（最重要，优先回应）：
${request.goal.requestNote?.trim() || '（用户没有额外补充，按目标与状态给出今天的安排）'}

前端 payload：
${JSON.stringify(currentRequest, null, 2)}

相关历史训练预览：
${JSON.stringify(memoryPreview, null, 2)}

确定性编程约束：
${JSON.stringify(programmingConstraints, null, 2)}

图像分析摘要：
${imageContextSummary ?? '未提供图像分析。'}

食物热量上下文：
${foodCalorieContext ?? '未提供食物热量上下文。'}

食物相关图片提示：
${foodCaloriePrompt ?? '未提供相关图片提示。'}

安排要求：
- 只安排一天，贴合用户的可用时长和器械。
- 把之前聊天里的偏好和记忆当作上下文，但以用户当前这句话为准；不要让历史助手建议覆盖用户明确说过的内容。
- 结合今天的状态调整强度与容量。
- date 使用上面的当前日期，除非用户明确要求另一天。
- 组数与次数必须是 JSON 整数，不要出现 "8-10" 这类区间。
- 面向用户的文字用简体中文。
- 最终只返回一个符合下述契约的 JSON 对象。

输出契约：
${dailyPlanOutputContract}

受支持动作：
${SUPPORTED_EXERCISE_GUIDANCE}
`.trim();

  return [
    ...historyMessages,
    {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  ];
};
