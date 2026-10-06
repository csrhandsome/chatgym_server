import type { AgentConsoleEvent, AgentEventType, AgentStepTrace } from './types';
import { agentEventSchema } from './types';
import { summarizeToolPayload } from './trace';

interface AgentEventInput {
  type: AgentEventType;
  summary: string;
  stage?: string;
  stepNumber?: number;
  toolName?: string;
  toolCallId?: string;
  text?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  finishReason?: string;
}

type EventListener = (event: AgentConsoleEvent) => void;

const toolDisplayNames: Record<string, string> = {
  searchWorkoutMemory: '训练记忆检索',
  recommendExercises: '动作推荐',
  getProgrammingConstraints: '训练约束查询',
  estimateFoodCalories: '食物热量估算',
  lookupFitnessEquipment: '器械识别',
};

const getToolDisplayName = (toolName: string) => toolDisplayNames[toolName] ?? toolName;

const buildPrimaryStepType = (events: AgentConsoleEvent[]): AgentEventType => {
  if (events.some((event) => event.type === 'tool_call')) {
    return 'tool_call';
  }

  if (events.some((event) => event.type === 'tool_result')) {
    return 'tool_result';
  }

  if (events.some((event) => event.type === 'text')) {
    return 'text';
  }

  if (events.some((event) => event.type === 'final')) {
    return 'final';
  }

  if (events.some((event) => event.type === 'error')) {
    return 'error';
  }

  return 'thinking';
};

export const createAgentEventRecorder = (requestId: string, listener?: EventListener) => {
  const events: AgentConsoleEvent[] = [];

  const emit = (input: AgentEventInput): AgentConsoleEvent => {
    const event = agentEventSchema.parse({
      id: crypto.randomUUID(),
      requestId,
      timestamp: new Date().toISOString(),
      ...input,
    });

    events.push(event);
    listener?.(event);

    return event;
  };

  return {
    events,
    emit,
  };
};

export const recordWorkflowThinking = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  {
    stage,
    summary,
    output,
  }: {
    stage: string;
    summary: string;
    output?: unknown;
  },
) =>
  emit({
    type: 'thinking',
    stage,
    summary,
    output,
  });

export const recordToolCall = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  {
    stepNumber,
    toolName,
    toolCallId,
    input,
    finishReason,
  }: {
    stepNumber?: number;
    toolName: string;
    toolCallId?: string;
    input?: Record<string, unknown>;
    finishReason?: string;
  },
) =>
  emit({
    type: 'tool_call',
    stepNumber,
    toolName,
    toolCallId,
    summary: `正在调用工具：${getToolDisplayName(toolName)}。`,
    input,
    finishReason,
  });

export const recordToolResult = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  {
    stepNumber,
    toolName,
    toolCallId,
    output,
    finishReason,
  }: {
    stepNumber?: number;
    toolName: string;
    toolCallId?: string;
    output: unknown;
    finishReason?: string;
  },
) =>
  emit({
    type: 'tool_result',
    stepNumber,
    toolName,
    toolCallId,
    summary: `已收到工具结果：${getToolDisplayName(toolName)}。`,
    output,
    finishReason,
  });

export const recordToolError = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  {
    stepNumber,
    toolName,
    toolCallId,
    error,
  }: {
    stepNumber?: number;
    toolName: string;
    toolCallId?: string;
    error: unknown;
  },
) =>
  emit({
    type: 'error',
    stepNumber,
    toolName,
    toolCallId,
    summary:
      error instanceof Error
        ? `工具执行失败：${getToolDisplayName(toolName)}，${error.message}`
        : `工具执行失败：${getToolDisplayName(toolName)}。`,
  });

export const recordAgentStep = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  step: {
    stepNumber: number;
    finishReason: string;
    text?: string;
    toolCalls: Array<{
      toolCallId?: string;
      toolName: string;
      dynamic?: boolean;
      input?: unknown;
    }>;
    toolResults: Array<{
      toolCallId?: string;
      toolName: string;
      output: unknown;
    }>;
  },
  options?: {
    emitToolEvents?: boolean;
    preRecordedEvents?: AgentConsoleEvent[];
  },
): AgentStepTrace => {
  const stepEvents: AgentConsoleEvent[] = [...(options?.preRecordedEvents ?? [])];
  const toolCalls = step.toolCalls.map((toolCall) => ({
    name: toolCall.toolName,
    toolCallId: toolCall.toolCallId,
    input:
      toolCall.dynamic === true || typeof toolCall.input !== 'object' || toolCall.input === null
        ? undefined
        : (toolCall.input as Record<string, unknown>),
  }));
  const toolResults = step.toolResults.map((toolResult) => ({
    name: toolResult.toolName,
    toolCallId: toolResult.toolCallId,
    success: true,
    summary: summarizeToolPayload(toolResult.output),
  }));

  if (toolCalls.length === 0 && toolResults.length === 0 && step.text) {
    stepEvents.push(
      emit({
        type: 'thinking',
        stepNumber: step.stepNumber,
        summary: '模型正在推理下一步操作。',
        text: step.text,
        finishReason: step.finishReason,
      }),
    );
  }

  if (options?.emitToolEvents !== false) {
    for (const toolCall of toolCalls) {
      stepEvents.push(
        recordToolCall(emit, {
          stepNumber: step.stepNumber,
          toolName: toolCall.name,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
          finishReason: step.finishReason,
        }),
      );
    }

    for (const toolResult of step.toolResults) {
      stepEvents.push(
        recordToolResult(emit, {
          stepNumber: step.stepNumber,
          toolName: toolResult.toolName,
          toolCallId: toolResult.toolCallId,
          output: toolResult.output,
          finishReason: step.finishReason,
        }),
      );
    }
  }

  if (step.text) {
    stepEvents.push(
      emit({
        type: 'text',
        stepNumber: step.stepNumber,
        summary: '模型已产出文本内容。',
        text: step.text,
        finishReason: step.finishReason,
      }),
    );
  }

  const summary =
    toolCalls.length > 0
      ? `已使用工具：${toolCalls.map((item) => getToolDisplayName(item.name)).join('、')}`
      : step.text
        ? '已生成一次推理步骤。'
        : `本轮已结束，原因：${step.finishReason}。`;

  return {
    stepNumber: step.stepNumber,
    type: buildPrimaryStepType(stepEvents),
    finishReason: step.finishReason,
    summary,
    toolCalls,
    toolResults,
    text: step.text || undefined,
    events: stepEvents,
  };
};
