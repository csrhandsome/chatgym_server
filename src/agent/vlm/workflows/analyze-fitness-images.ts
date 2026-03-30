import { Output, ToolLoopAgent, stepCountIs } from 'ai';
import type { ServerRuntime } from '../../../runtime';
import { createAgentEventRecorder, recordAgentStep, recordWorkflowThinking } from '../../shared/agent-events';
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
  const { emit, events } = createAgentEventRecorder(requestId, onEvent);
  const trace = [
    timestampedTrace(
      'vlm-input',
      'completed',
      `Received ${request.images.length} image(s) for visual analysis.`,
      {
        preferredTask: request.preferredTask ?? null,
      },
    ),
  ];

  recordWorkflowThinking(emit, {
    stage: 'vlm-input',
    summary: `Received ${request.images.length} image(s) for visual analysis.`,
    output: {
      preferredTask: request.preferredTask ?? null,
    },
  });

  const agentSteps: AgentStepTrace[] = [];
  const tools = createVlmTools();

  const agent = new ToolLoopAgent({
    id: 'fitness-vlm-agent',
    model: resolveVisionModel(),
    instructions: vlmSystemPrompt,
    tools,
    output: Output.object({
      schema: vlmOutputSchema,
    }),
    temperature: 0.2,
    stopWhen: stepCountIs(5),
  });

  const result = await agent.generate({
    prompt: buildVlmMessages(request),
    onStepFinish(step) {
      agentSteps.push(recordAgentStep(emit, step));
    },
  });

  const parsed = vlmOutputSchema.parse(result.output);

  trace.push(
    timestampedTrace('vlm-analysis', 'completed', `VLM workflow completed with task ${parsed.task}.`, {
      resultCount: parsed.results.length,
      task: parsed.task,
    }),
  );

  recordWorkflowThinking(emit, {
    stage: 'vlm-analysis',
    summary: `VLM workflow completed with task ${parsed.task}.`,
    output: {
      resultCount: parsed.results.length,
      task: parsed.task,
    },
  });

  if (emitFinalEvent) {
    emit({
      type: 'final',
      stage: 'vlm-analysis',
      summary: 'Visual analysis completed.',
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
