import { expect, test } from 'bun:test';
import { generateTrainingPlan } from '../../planning/workflows/generate-training-plan';
import { reviewTrainingPlan } from '../../planning/review/review-training-plan';
import { createMemoryFixture, createPlanRequest, createTestRuntime, createValidPlan, toolReply,
  visionResult, withModelReplies } from './fixtures';

test('valid draft requires one model request and skips normalization and repair', async () => {
  const fixture = createMemoryFixture();
  try {
    const request = createPlanRequest();
    const plan = createValidPlan();
    expect(reviewTrainingPlan({ request, plan }).status).toBe('pass');
    const result = await withModelReplies([JSON.stringify(plan)], () =>
      generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request }));
    expect(result.calls).toHaveLength(1);
    expect(result.value.review.status).toBe('pass');
    expect(result.value.trace.some((item) => item.stage === 'plan-normalization')).toBe(false);
  } finally { fixture.close(); }
});

test('invalid JSON adds a normalization request', async () => {
  const fixture = createMemoryFixture();
  try {
    const result = await withModelReplies(['invalid JSON', JSON.stringify(createValidPlan())], () =>
      generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request: createPlanRequest() }));
    expect(result.calls).toHaveLength(2);
    expect(result.value.trace.some((item) => item.stage === 'plan-normalization')).toBe(true);
    expect(result.value.review.status).toBe('pass');
  } finally { fixture.close(); }
});

test('failed deterministic review adds a repair request', async () => {
  const fixture = createMemoryFixture();
  try {
    const badPlan = createValidPlan();
    badPlan.weeklySchedule.push({ ...structuredClone(badPlan.weeklySchedule[0]!), dayIndex: 3, dayLabel: '周三' });
    badPlan.weeklyFrequency = 2;
    const request = createPlanRequest();
    expect(reviewTrainingPlan({ request, plan: badPlan }).status).toBe('needs-repair');
    const result = await withModelReplies([JSON.stringify(badPlan), JSON.stringify(createValidPlan())], () =>
      generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request }));
    expect(result.calls).toHaveLength(2);
    expect(result.value.trace.find((item) => item.stage === 'plan-repair')?.status).toBe('completed');
    expect(result.value.review.status).toBe('pass');
  } finally { fixture.close(); }
});

test('image analysis and tool loop introduce sequential model requests', async () => {
  const fixture = createMemoryFixture();
  try {
    const request = createPlanRequest();
    request.inputImages = [{ image: 'https://chatgym-test.invalid/image.png', detail: 'auto' }];
    const result = await withModelReplies([
      JSON.stringify(visionResult), toolReply, JSON.stringify(createValidPlan()),
    ], () => generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request }));
    expect(result.calls).toHaveLength(3);
    expect(result.value.imageContext?.used).toBe(true);
    expect(result.value.agentSteps.some((step) => step.toolCalls.some((tool) => tool.name === 'recommendExercises'))).toBe(true);
  } finally { fixture.close(); }
});
