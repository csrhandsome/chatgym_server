import type { AgentConsoleEvent, AgentEventType, AgentStepTrace } from './types';
import { agentEventSchema } from './types';
import { summarizeToolPayload } from './trace';

interface AgentEventInput {
  type: AgentEventType;
  summary: string;
  stage?: string;
  stepNumber?: number;
  toolName?: string;
  text?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  finishReason?: string;
}

type EventListener = (event: AgentConsoleEvent) => void;

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

export const recordAgentStep = (
  emit: (input: AgentEventInput) => AgentConsoleEvent,
  step: {
    stepNumber: number;
    finishReason: string;
    text?: string;
    toolCalls: Array<{
      toolName: string;
      dynamic?: boolean;
      input?: unknown;
    }>;
    toolResults: Array<{
      toolName: string;
      output: unknown;
    }>;
  },
): AgentStepTrace => {
  const stepEvents: AgentConsoleEvent[] = [];
  const toolCalls = step.toolCalls.map((toolCall) => ({
    name: toolCall.toolName,
    input:
      toolCall.dynamic === true || typeof toolCall.input !== 'object' || toolCall.input === null
        ? undefined
        : (toolCall.input as Record<string, unknown>),
  }));
  const toolResults = step.toolResults.map((toolResult) => ({
    name: toolResult.toolName,
    success: true,
    summary: summarizeToolPayload(toolResult.output),
  }));

  if (toolCalls.length === 0 && toolResults.length === 0 && step.text) {
    stepEvents.push(
      emit({
        type: 'thinking',
        stepNumber: step.stepNumber,
        summary: 'Model is reasoning about the next action.',
        text: step.text,
        finishReason: step.finishReason,
      }),
    );
  }

  for (const toolCall of toolCalls) {
    stepEvents.push(
      emit({
        type: 'tool_call',
        stepNumber: step.stepNumber,
        toolName: toolCall.name,
        summary: `Calling tool ${toolCall.name}.`,
        input: toolCall.input,
        finishReason: step.finishReason,
      }),
    );
  }

  for (const toolResult of step.toolResults) {
    stepEvents.push(
      emit({
        type: 'tool_result',
        stepNumber: step.stepNumber,
        toolName: toolResult.toolName,
        summary: `Received result from ${toolResult.toolName}.`,
        output: toolResult.output,
        finishReason: step.finishReason,
      }),
    );
  }

  if (step.text) {
    stepEvents.push(
      emit({
        type: 'text',
        stepNumber: step.stepNumber,
        summary: 'Model produced text output.',
        text: step.text,
        finishReason: step.finishReason,
      }),
    );
  }

  const summary =
    toolCalls.length > 0
      ? `Used ${toolCalls.map((item) => item.name).join(', ')}`
      : step.text
        ? 'Generated a reasoning step.'
        : `Finished with ${step.finishReason}.`;

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
