import { ToolLoopAgent, stepCountIs } from 'ai';
import type { ServerRuntime } from '../../../runtime';
import {
  createAgentEventRecorder,
  recordAgentStep,
  recordToolCall,
  recordToolError,
  recordToolResult,
  recordWorkflowThinking,
} from '../../shared/agent-events';
import { parseJsonObjectFromModelText } from '../../shared/json-output';
import { toSdkImagePart } from '../../shared/image-input';
import { resolveVisionModel } from '../../shared/models';
import { timestampedTrace } from '../../shared/trace';
import type { AgentConsoleEvent, AgentStepTrace, VlmAnalyzeRequest, VlmAnalyzeResponse } from '../../shared/types';
import { vlmAnalyzeResponseSchema, vlmImageInsightSchema, vlmTaskSchema } from '../../shared/types';
import { buildVlmMessages } from '../prompts/user-message';
import { vlmSystemPrompt } from '../prompts/system';
import { createVlmTools } from '../tools/create-vlm-tools';
import { z } from 'zod';

const vlmOutputSchema = z.object({
  task: vlmTaskSchema,
  summary: z.string().min(1).max(3000),
  results: z.array(vlmImageInsightSchema).min(1).max(6),
});

export const analyzeFitnessImages = async ({
  runtime: _runtime,
  request,
  requestId = crypto.randomUUID(),
  onEvent,
  emitFinalEvent = true,
}: {
  runtime: ServerRuntime;
  request: VlmAnalyzeRequest;
  requestId?: string;
  onEvent?: (event: AgentConsoleEvent) => void;
  emitFinalEvent?: boolean;
}): Promise<VlmAnalyzeResponse> => {
  const imageParts = request.images.map(toSdkImagePart);
  const prompt = buildVlmMessages(request);
  for (const message of prompt) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      message.content = [...message.content.filter((part) => part.type !== 'image'), ...imageParts];
    }
  }
  const { emit, events } = createAgentEventRecorder(requestId, onEvent);
  const trace = [
    timestampedTrace(
      'vlm-input',
      'completed',
      `已接收 ${request.images.length} 张图片用于视觉分析。`,
      {
        preferredTask: request.preferredTask ?? null,
      },
    ),
  ];

  recordWorkflowThinking(emit, {
    stage: 'vlm-input',
    summary: `已接收 ${request.images.length} 张图片用于视觉分析。`,
    output: {
      preferredTask: request.preferredTask ?? null,
    },
  });

  const agentSteps: AgentStepTrace[] = [];
  let currentStepNumber: number | undefined;
  let stepEventCursor = events.length;
  const tools = createVlmTools({
    onToolCall: ({ toolName, toolCallId, input }) => {
      recordToolCall(emit, {
        stepNumber: currentStepNumber,
        toolName,
        toolCallId,
        input,
      });
    },
    onToolResult: ({ toolName, toolCallId, output }) => {
      recordToolResult(emit, {
        stepNumber: currentStepNumber,
        toolName,
        toolCallId,
        output,
      });
    },
    onToolError: ({ toolName, toolCallId, error }) => {
      recordToolError(emit, {
        stepNumber: currentStepNumber,
        toolName,
        toolCallId,
        error,
      });
    },
  });

  const agent = new ToolLoopAgent({
    id: 'fitness-vlm-agent',
    model: resolveVisionModel(),
    instructions: vlmSystemPrompt,
    tools,
    temperature: 0.2,
    stopWhen: stepCountIs(5),
    prepareStep: ({ stepNumber }) => {
      currentStepNumber = stepNumber;

      return {};
    },
  });

  const result = await agent.generate({
    prompt,
    onStepFinish(step) {
      agentSteps.push(
        recordAgentStep(emit, step, {
          emitToolEvents: false,
          preRecordedEvents: events
            .slice(stepEventCursor)
            .filter((event) => event.stepNumber === step.stepNumber),
        }),
      );
      stepEventCursor = events.length;
    },
  });

  const parsed = parseJsonObjectFromModelText(result.text, vlmOutputSchema, 'vlm analysis');

  trace.push(
    timestampedTrace('vlm-analysis', 'completed', `视觉分析流程已完成，任务类型为 ${parsed.task}。`, {
      resultCount: parsed.results.length,
      task: parsed.task,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'vlm-analysis',
    summary: `视觉分析流程已完成，任务类型为 ${parsed.task}。`,
    output: {
      resultCount: parsed.results.length,
      task: parsed.task,
    },
  });

  if (emitFinalEvent) {
    emit({
      type: 'final',
      stage: 'vlm-analysis',
      summary: '视觉分析完成。',
      output: {
        task: parsed.task,
        summary: parsed.summary,
        results: parsed.results,
      },
    });
  }

  return vlmAnalyzeResponseSchema.parse({
    requestId,
    generatedAt: new Date().toISOString(),
    task: parsed.task,
    summary: parsed.summary,
    results: parsed.results,
    trace,
    agentSteps,
    agentEvents: events,
  });
};
