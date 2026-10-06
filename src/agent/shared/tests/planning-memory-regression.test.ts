import { expect, test } from 'bun:test';
import { generatePlanningResponse } from '../../planning/workflows/generate-training-plan';
import { planRequestSchema } from '../types';
import { MemoryUnavailableError } from '../mem0-adapter';
import { createWorkflowHarness as createHarness } from './regression-fixtures';
import {
  planRequest, validPlan, withModelReplies,
} from '../../../../tests/api/fixtures';

for (const mode of ['dialog', 'plan'] as const) {
  test(`${mode} recalls user facts with provenance and remembers only the user input`, async () => {
    const h = createHarness();
    const userId = 'authenticated-memory-user';
    const requestId = crypto.randomUUID();
    const historicalFact = '我的右膝需要保护，只在家用哑铃训练。';
    const userInput = mode === 'dialog' ? '右膝需要保护，在家哑铃怎么练？' : '请给我右膝友好的在家哑铃训练计划。';
    const answer = 'ASSISTANT_ONLY_SUGGESTION：建议尝试轻重量。';
    const response = validPlan();
    response.summary = answer;
    try {
      await h.runtime.workoutMemoryStore.rememberConversation(userId,
        [{ role: 'user', content: historicalFact }],
        { sourceId: 'historical-user-input', source: 'prior_chat' });
      await h.runtime.workoutMemoryStore.rememberConversation('another-memory-user',
        [{ role: 'user', content: 'OTHER_USER_PRIVATE_FACT' }],
        { sourceId: 'other-user-input', source: 'prior_chat' });
      const request = planRequestSchema.parse({ ...planRequest(), mode,
        user: { id: userId, trainingExperience: 'intermediate' },
        goal: { primary: 'muscle_gain', requestNote: userInput },
      });
      const result = await withModelReplies([mode === 'dialog' ? answer : JSON.stringify(response)], () =>
        generatePlanningResponse({ runtime: h.runtime, request, requestId }));
      expect(result.calls).toHaveLength(1);
      const prompt = JSON.stringify(result.calls[0]!.messages);
      expect(prompt).toContain('Historical user facts and preferences, with provenance metadata');
      expect(prompt).toContain(historicalFact);
      expect(prompt).toContain('historical-user-input');
      expect(prompt).not.toContain('OTHER_USER_PRIVATE_FACT');
      const memories = await h.runtime.workoutMemoryStore.searchMemories(userId, '右膝 哑铃', { limit: 8 });
      expect(memories.some((memory) => memory.metadata.sourceId === requestId &&
        memory.metadata.source === 'planning_chat')).toBe(true);
      expect(JSON.stringify(memories)).not.toContain('ASSISTANT_ONLY_SUGGESTION');
      expect(memories.every((memory) => memory.userId === userId)).toBe(true);
      if ('answer' in result.value) expect(result.value.answer).toBe(answer);
    } finally { h.close(); }
  });
}

test('plan normalization retains retrieved facts and does not remember model drafts', async () => {
  const h = createHarness();
  const userId = 'normalization-memory-user';
  const historicalFact = '我的右膝需要保护，只在家用哑铃训练。';
  try {
    await h.runtime.workoutMemoryStore.rememberConversation(userId,
      [{ role: 'user', content: historicalFact }],
      { sourceId: 'normalization-prior', source: 'prior_chat' });
    const request = planRequestSchema.parse({ ...planRequest(),
      user: { id: userId, trainingExperience: 'intermediate' },
      goal: { primary: 'muscle_gain', requestNote: '请给我右膝友好的在家哑铃训练计划。' },
    });
    const draft = 'MODEL_DRAFT_MARKER：这是一段非结构化训练建议。';
    const result = await withModelReplies([draft, JSON.stringify(validPlan())], () =>
      generatePlanningResponse({ runtime: h.runtime, request }));
    expect(result.calls).toHaveLength(2);
    expect(JSON.stringify(result.calls[1]!.messages)).toContain(historicalFact);
    expect(JSON.stringify(result.calls[1]!.messages)).toContain('normalization-prior');
    const memories = await h.runtime.workoutMemoryStore.searchMemories(userId, '右膝 哑铃', { limit: 8 });
    expect(JSON.stringify(memories)).not.toContain('MODEL_DRAFT_MARKER');
  } finally { h.close(); }
});

test('plan repair retains facts and their provenance', async () => {
  const h = createHarness();
  const userId = 'repair-memory-user';
  try {
    await h.runtime.workoutMemoryStore.rememberConversation(userId,
      [{ role: 'user', content: '我只在家用哑铃训练。' }],
      { sourceId: 'repair-prior', source: 'prior_chat' });
    const request = planRequestSchema.parse({ ...planRequest(),
      user: { id: userId, trainingExperience: 'intermediate' },
      goal: { primary: 'muscle_gain', requestNote: '请给我在家哑铃训练计划。' },
    });
    const badPlan = validPlan(2);
    const result = await withModelReplies([JSON.stringify(badPlan), JSON.stringify(validPlan())], () =>
      generatePlanningResponse({ runtime: h.runtime, request }));
    expect(result.calls).toHaveLength(2);
    expect(result.value.trace.some((item) => item.stage === 'plan-repair' && item.status === 'completed')).toBe(true);
    expect(JSON.stringify(result.calls[1]!.messages)).toContain('我只在家用哑铃训练。');
    expect(JSON.stringify(result.calls[1]!.messages)).toContain('repair-prior');
  } finally { h.close(); }
});

test('Mem0 failure remains visible and does not trigger a model or manual fallback', async () => {
  const h = createHarness();
  const error = new MemoryUnavailableError();
  h.adapter.search = async () => { throw error; };
  try {
    const result = await withModelReplies([], async () => {
      await expect(generatePlanningResponse({ runtime: h.runtime, request: planRequest() })).rejects.toBe(error);
    });
    expect(result.calls).toHaveLength(0);
  } finally { h.close(); }
});

for (const mode of ['dialog', 'plan'] as const) {
  test(`${mode} uses role-aware history without ingesting prior user or assistant text`, async () => {
    const h = createHarness();
    const userId = 'current-account-b';
    const requestId = crypto.randomUUID();
    const userInput = mode === 'dialog' ? '我目前只有哑铃，怎么练？' : '请给我本周哑铃训练计划。';
    const chatHistory = [
      { role: 'user' as const, text: 'ACCOUNT_A_USER_HISTORY：我曾经在健身房训练。' },
      { role: 'assistant' as const, text: 'ACCOUNT_A_ASSISTANT_SUGGESTION：建议尝试杠铃卧推。' },
    ];
    const answer = 'MODEL_CURRENT_ANSWER：按当前哑铃条件安排训练。';
    try {
      const request = planRequestSchema.parse({ ...planRequest(), mode, chatHistory,
        user: { id: userId, trainingExperience: 'intermediate' },
        goal: { primary: 'muscle_gain', requestNote: userInput },
      });
      const result = await withModelReplies([mode === 'dialog' ? answer : JSON.stringify(validPlan())], () =>
        generatePlanningResponse({ runtime: h.runtime, request, requestId }));
      expect(result.calls).toHaveLength(1);
      const messages = result.calls[0]!.messages as Array<{ role: string; content: unknown }>;
      const context = messages.filter((message) => message.role !== 'system');
      expect(context.slice(0, 2)).toEqual(chatHistory.map(({ role, text }) => ({ role, content: text })));
      expect(JSON.stringify(context.slice(2))).toContain(userInput);
      expect(JSON.stringify(context.slice(2))).not.toContain('ACCOUNT_A_');
      const memories = await h.runtime.workoutMemoryStore.listMemories(userId);
      expect(memories).toHaveLength(1);
      expect(memories[0]!.metadata.sourceInput).toEqual([{ role: 'user', content: userInput }]);
      expect(memories[0]!.metadata.sourceId).toBe(requestId);
      expect(JSON.stringify(memories)).not.toContain('ACCOUNT_A_');
      expect(JSON.stringify(memories)).not.toContain('MODEL_CURRENT_ANSWER');
    } finally { h.close(); }
  });
}

test('history alone never causes a conversation memory write', async () => {
  const h = createHarness();
  try {
    const request = planRequestSchema.parse({ ...planRequest(), mode: 'dialog', chatHistory: [
      { role: 'user', text: 'PRIOR_USER_HISTORY：以前只有哑铃。' },
      { role: 'assistant', text: 'PRIOR_ASSISTANT_SUGGESTION：可以进行推举。' },
    ] });
    const result = await withModelReplies(['请补充你当前的问题。'], () =>
      generatePlanningResponse({ runtime: h.runtime, request }));
    expect(JSON.stringify(result.calls[0]!.messages)).toContain('PRIOR_ASSISTANT_SUGGESTION');
    expect(h.adapter.calls.filter((call) => call.operation === 'add')).toHaveLength(0);
    expect(await h.runtime.workoutMemoryStore.listMemories(request.user.id)).toEqual([]);
  } finally { h.close(); }
});

test('conversation sourceInput preserves exact current user text including whitespace', async () => {
  const h = createHarness();
  const userInput = '  \n我目前只有哑铃，怎么练？\n\t ';
  try {
    const request = planRequestSchema.parse({ ...planRequest(), mode: 'dialog',
      goal: { primary: 'general_fitness', requestNote: userInput },
      chatHistory: [{ role: 'assistant', text: 'HISTORY_NOT_CURRENT_INPUT' }],
    });
    await withModelReplies(['可以从轻重量开始。'], () =>
      generatePlanningResponse({ runtime: h.runtime, request }));
    const memories = await h.runtime.workoutMemoryStore.listMemories(request.user.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]!.metadata.sourceInput).toEqual([{ role: 'user', content: userInput }]);
    expect(JSON.stringify(memories)).not.toContain('HISTORY_NOT_CURRENT_INPUT');
  } finally { h.close(); }
});

test('whitespace-only current input does not ingest conversation history', async () => {
  const h = createHarness();
  try {
    const request = planRequestSchema.parse({ ...planRequest(), mode: 'dialog',
      goal: { primary: 'general_fitness', requestNote: ' \n\t ' },
      chatHistory: [{ role: 'user', text: 'HISTORY_NOT_CURRENT_INPUT' }],
    });
    const result = await withModelReplies(['请补充你当前的问题。'], () =>
      generatePlanningResponse({ runtime: h.runtime, request }));
    expect(h.adapter.calls.filter((call) => call.operation === 'add')).toHaveLength(0);
    expect(result.value.trace.find((entry) => entry.stage === 'conversation-memory')?.status).toBe('skipped');
  } finally { h.close(); }
});
