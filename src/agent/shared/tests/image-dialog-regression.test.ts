import { describe, expect, test } from 'bun:test';
import { generatePlanningResponse } from '../../planning/workflows/generate-training-plan';
import { analyzeFitnessImages } from '../../vlm/workflows/analyze-fitness-images';
import { toSdkImagePart } from '../image-input';
import { planRequestSchema, planningDialogResponseSchema } from '../types';
import { createWorkflowHarness as createHarness } from './regression-fixtures';
import {
  imageDataUrl, imageUrl, planRequest, recommendToolReply,
  visionReply, withModelReplies,
} from '../../../../tests/api/fixtures';

describe('validated SDK image input', () => {
  test('camera data URLs become binary image parts with provider detail', () => {
    const part = toSdkImagePart({ image: imageDataUrl, detail: 'low' });
    expect(part.image).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(part.image as Uint8Array).toString('base64')).toBe(imageDataUrl.split(',')[1]!);
    expect(part.mediaType).toBe('image/png');
    expect(part.providerOptions).toEqual({
      openai: { imageDetail: 'low' },
      openaiCompatible: { image_url: { url: imageDataUrl, detail: 'low' } },
    });
  });

  test('unpadded camera data and uppercase media types are accepted', () => {
    const part = toSdkImagePart({ image: imageDataUrl.replace('image/png', 'IMAGE/PNG').replace(/=+$/, ''), detail: 'auto' });
    expect(part.mediaType).toBe('image/png');
    expect(part.providerOptions).toBeUndefined();
  });

  for (const [mediaType, bytes] of [
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/gif', [...Buffer.from('GIF89a')]],
    ['image/webp', [...Buffer.from('RIFF\x04\x00\x00\x00WEBP')]],
  ] as const) {
    test(`recognizes ${mediaType} media signatures`, () => {
      const part = toSdkImagePart({ image: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`, detail: 'auto' });
      expect(part.mediaType).toBe(mediaType);
    });
  }

  for (const image of [
    '', 'file:///tmp/image.png', 'javascript:alert(1)', 'image.png',
    'data:image/png;base64,', 'data:image/png,abc', 'data:;base64,YQ==',
    'data:text/plain;base64,YQ==', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!!!!', 'data:image/png;base64,a',
    'data:image/png;base64,YQ=', 'data:image/png;base64,YR==',
    'data:image/png;base64,YQ==', imageDataUrl.replace('image/png', 'image/jpeg'),
  ]) {
    test(`rejects invalid image input ${image.slice(0, 55)}`, () => {
      expect(() => toSdkImagePart({ image, detail: 'auto' })).toThrow();
    });
  }

  test('HTTPS remains an SDK URL image part', () => {
    const part = toSdkImagePart({ image: imageUrl, detail: 'high' });
    expect(part.image).toBeInstanceOf(URL);
    expect(String(part.image)).toBe(imageUrl);
    expect(part.mediaType).toBeUndefined();
  });

  test('real vision SDK sends inline image without downloading a data URL', async () => {
    const h = createHarness();
    try {
      const result = await withModelReplies([JSON.stringify(visionReply())], () => analyzeFitnessImages({
        runtime: h.runtime,
        request: { images: [{ image: imageDataUrl, detail: 'low' }], preferredTask: 'food_calorie_estimate' },
      }));
      expect(result.calls).toHaveLength(1);
      expect(result.imageDownloads).toBe(0);
      const messages = result.calls[0]!.messages as Array<{ role: string; content: unknown }>;
      const content = messages.find((message) => message.role === 'user')!.content as Array<Record<string, unknown>>;
      expect(content.find((part) => part.type === 'image_url')).toEqual({
        type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' },
      });
      expect(result.value.task).toBe('food_calorie_estimate');
    } finally { h.close(); }
  });

  test('malformed image is rejected before any model HTTP request', async () => {
    const h = createHarness();
    try {
      const result = await withModelReplies([], async () => {
        await expect(analyzeFitnessImages({ runtime: h.runtime,
          request: { images: [{ image: 'data:image/png;base64,not-valid', detail: 'auto' }] },
        })).rejects.toThrow('Invalid image data URL');
      });
      expect(result.calls).toHaveLength(0);
      expect(result.imageDownloads).toBe(0);
    } finally { h.close(); }
  });
});

describe('plain dialog workflow preserves the model answer', () => {
  test('model memory tool arguments cannot select another user', async () => {
    const h = createHarness();
    try {
      await h.runtime.workoutMemoryStore.storeSessions('another-user', [{
        completedAt: new Date().toISOString(), sessionType: 'strength', durationMinutes: 60,
        exerciseNames: ['卧推'], muscleGroups: ['胸'], intensity: 'medium', notes: 'PRIVATE_OTHER_USER',
      }]);
      const request = planRequestSchema.parse({ ...planRequest(), mode: 'plan' });
      const reply = { tool_calls: [{ id: 'forged-memory-user', type: 'function', function: {
        name: 'searchWorkoutMemory', arguments: JSON.stringify({ userId: 'another-user',
          query: '卧推', targetMuscles: ['胸'], limit: 5 }),
      } }] };
      const { validPlan } = await import('../../../../tests/api/fixtures');
      const result = await withModelReplies([reply, JSON.stringify(validPlan())], () =>
        generatePlanningResponse({ runtime: h.runtime, request }));
      expect(result.calls).toHaveLength(2);
      expect(JSON.stringify(result.calls)).not.toContain('PRIVATE_OTHER_USER');
      const toolEvent = result.value.agentEvents.find((event) => event.type === 'tool_result' &&
        event.toolName === 'searchWorkoutMemory');
      expect(toolEvent?.output).toEqual({ matches: [] });
    } finally { h.close(); }
  });

  for (const toolCall of [false, true]) {
    test(`returns exact plain text ${toolCall ? 'after a real tool call' : 'in one model request'}`, async () => {
      const h = createHarness();
      const answer = '保持肩胛稳定，控制下放。\n\n提示：不要把 {动作名称} 当作 JSON。';
      const observed: Array<{ type: string; output?: unknown }> = [];
      try {
        const request = planRequestSchema.parse({ ...planRequest(), mode: 'dialog',
          goal: { primary: 'general_fitness', requestNote: '卧推怎么做？' },
        });
        const result = await withModelReplies(toolCall ? [recommendToolReply, answer] : [answer], () =>
          generatePlanningResponse({ runtime: h.runtime, request, onEvent: (event) => observed.push(event) }));
        const response = planningDialogResponseSchema.parse(result.value);
        expect(response.answer).toBe(answer);
        expect(result.calls).toHaveLength(toolCall ? 2 : 1);
        expect(response.trace.some((item) => item.stage === 'plan-normalization')).toBe(false);
        expect(response.trace.some((item) => item.stage === 'plan-review')).toBe(false);
        expect(observed.at(-1)?.type).toBe('final');
        expect(observed.at(-1)?.output).toMatchObject({ mode: 'dialog', answer });
        expect(response.agentEvents.at(-1)?.type).toBe('final');
      } finally { h.close(); }
    });
  }
});
