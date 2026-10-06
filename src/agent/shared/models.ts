import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const DEFAULT_PROVIDER_NAME = 'siliconflow';
const DEFAULT_PROVIDER_BASE_URL = 'https://api.siliconflow.cn/v1';
const DEFAULT_PLANNING_MODEL = 'Pro/zai-org/GLM-5';
const DEFAULT_VLM_MODEL = 'Pro/zai-org/GLM-5';

const resolveProviderApiKey = () => Bun.env.AI_PROVIDER_API_KEY ?? Bun.env.AI_GATEWAY_API_KEY;
const resolveProviderBaseUrl = () => Bun.env.AI_PROVIDER_BASE_URL ?? DEFAULT_PROVIDER_BASE_URL;
const resolveProviderName = () => Bun.env.AI_PROVIDER_NAME ?? DEFAULT_PROVIDER_NAME;

// DeepSeek's flash/v4 models are reasoning models that emit a long chain-of-thought
// (reasoning_content) before the answer, which dominates plan/VLM latency. The only
// effective lever is `thinking: {type: "disabled"}` — `reasoning_effort` does not help.
const disableThinking = () => Bun.env.AI_PROVIDER_DISABLE_THINKING === 'true';

const resolveProvider = () =>
  createOpenAICompatible({
    name: resolveProviderName(),
    apiKey: resolveProviderApiKey(),
    baseURL: resolveProviderBaseUrl(),
    transformRequestBody: disableThinking()
      ? (args) => ({ ...args, thinking: { type: 'disabled' } })
      : undefined,
  });

export const ensureAgentConfig = () => {
  if (!resolveProviderApiKey()) {
    throw new Error(
      'Missing AI_PROVIDER_API_KEY. This server now uses an OpenAI-compatible provider and requires an API key.',
    );
  }
};

export const resolvePlanningModel = () =>
  resolveProvider()(Bun.env.GYM_AGENT_MODEL ?? DEFAULT_PLANNING_MODEL);

export const resolveVisionModel = () =>
  resolveProvider()(Bun.env.GYM_VLM_MODEL ?? Bun.env.GYM_AGENT_MODEL ?? DEFAULT_VLM_MODEL);
