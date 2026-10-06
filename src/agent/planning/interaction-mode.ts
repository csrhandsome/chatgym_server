import type { PlanRequestInput } from '../shared/types';

export type PlanningInteractionMode = 'plan' | 'dialog';

const normalizeToken = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_]+/g, '-') : null;

const dialogModeTokens = new Set([
  'dialog',
  'dialogue',
  'chat',
  'conversation',
  'conversational',
  'qa',
  'q&a',
  'follow-up',
  'followup',
  'adjust',
  'adjustment',
]);

const planModeTokens = new Set([
  'plan',
  'planning',
  'program',
  'programme',
  'routine',
  'full-plan',
  'structured-plan',
]);

const minimalToolTokens = new Set(['minimal', 'light', 'fast', 'lean', 'single-tool']);
const fullToolTokens = new Set(['full', 'rich', 'auto', 'standard']);

const dialogHintPattern =
  /[?？]|怎么|如何|为什么|为何|能不能|可以.*吗|帮我看|解释|说明|聊聊|问下|改一下|调整|替换|换成|修改|quick|why|what|how|can you|could you|should i|swap|replace|adjust|modify|explain/i;
const fullPlanHintPattern =
  /(生成|制定|安排|输出|给我).{0,12}(训练计划|课表|计划)|完整.{0,8}(训练计划|课表|计划)|(^|\b)(weekly|workout|training)\s+plan\b|(^|\b)(2|4)\s*weeks?\b|一周|两周|二周|四周/u;

export const resolvePlanningInteractionMode = (
  request: PlanRequestInput,
): PlanningInteractionMode => {
  if (request.conversationMode === true) {
    return 'dialog';
  }

  if (request.conversationMode === false) {
    return 'plan';
  }

  const explicitTokens = [request.interactionMode, request.responseMode, request.mode]
    .map(normalizeToken)
    .filter((value): value is string => Boolean(value));

  for (const token of explicitTokens) {
    if (dialogModeTokens.has(token)) {
      return 'dialog';
    }

    if (planModeTokens.has(token)) {
      return 'plan';
    }
  }

  const toolStrategyToken = normalizeToken(request.toolStrategy);

  if (toolStrategyToken && minimalToolTokens.has(toolStrategyToken)) {
    return 'dialog';
  }

  if (toolStrategyToken && fullToolTokens.has(toolStrategyToken)) {
    return 'plan';
  }

  const requestNote = request.goal.requestNote?.trim() ?? '';

  if (!requestNote) {
    return 'plan';
  }

  if (dialogHintPattern.test(requestNote) && !fullPlanHintPattern.test(requestNote) && requestNote.length <= 160) {
    return 'dialog';
  }

  return 'plan';
};
