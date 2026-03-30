import { gateway } from 'ai';

const DEFAULT_PLANNING_MODEL = 'openai/gpt-5-mini';
const DEFAULT_VLM_MODEL = 'openai/gpt-4o-mini';

export const ensureAgentConfig = () => {
  if (!Bun.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY. This server uses the AI SDK gateway model path because only the core ai package is installed.',
    );
  }
};

export const resolvePlanningModel = () =>
  gateway(Bun.env.GYM_AGENT_MODEL ?? DEFAULT_PLANNING_MODEL);

export const resolveVisionModel = () => gateway(Bun.env.GYM_VLM_MODEL ?? DEFAULT_VLM_MODEL);
