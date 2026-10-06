import { afterAll, describe, expect, test } from 'bun:test';
import { createApp } from '../../../app';
import { createAgentSseResponse } from '../../../api/sse';
import { buildRuntimeSnapshot } from '../../../runtime';
import { TextStore } from '../../../services/text-store';
import { TextStreamHub } from '../../../services/text-stream-hub';
import { generateTrainingPlan } from '../../planning/workflows/generate-training-plan';
import { recommendExercisesFromCatalog } from '../exercise-catalog';
import type { AgentConsoleEvent } from '../types';
import { createMemoryFixture, createPlanRequest, createSessions, createTestRuntime,
  createValidPlan, seedSessions, testImageDataUrl, toolReply, visionResult, withModelReplies } from './fixtures';
import { diagnostics, measure, recordMeasurement, timerDelayDuring, writePerformanceReport } from './performance-utils';

// Explicit opt-in: disk benchmarks and simulated latency should not slow down CI.
const enabled = Bun.env.RUN_PERFORMANCE_TESTS === '1';
const performanceSuite = enabled ? describe : describe.skip;

performanceSuite('performance bottleneck diagnostics', () => {
  if (enabled) afterAll(writePerformanceReport);

  test('cached Mem0 health summary does not contact the adapter', async () => {
    const fixture = createMemoryFixture();
    try {
      await seedSessions(fixture.store, 1000);
      const before = fixture.adapter.calls.length;
      const runtime = createTestRuntime(fixture.store);
      measure('mem0/cached-summary', () => buildRuntimeSnapshot(runtime));
      expect(fixture.adapter.calls.length).toBe(before);
      expect(await fixture.store.getUserSessionCount('user-0')).toBe(100);
    } finally { fixture.close(); }
  });

  test('measure text storage, catalog lookup, and websocket fanout as controls', () => {
    for (const retention of [200, 20_000]) {
      const store = new TextStore(retention);
      for (let index = 0; index < retention; index++) {
        store.add({ text: 'hello', source: 'test', userId: `user-${index % 100}` });
      }
      measure(`text/listForUser/retention-${retention}`, () => store.listRecentForUser('user-0'), { operations: 100 });
      const latestId = store.getSummary().latestRecordId!;
      measure(`text/getById/retention-${retention}`, () => store.getById(latestId), { operations: 100 });
      measure(`text/add/retention-${retention}`, () => store.add({ text: 'hello', source: 'test' }), { operations: 100 });
    }
    measure('catalog/recommendExercises', () => recommendExercisesFromCatalog({
      focus: '胸部增肌', targetMuscles: ['胸'], availableEquipment: ['杠铃', '龙门架'],
      avoidExercises: [], trainingExperience: 'intermediate', limit: 5,
    }), { operations: 100 });
    for (const connections of [1, 100, 1000]) {
      const hub = new TextStreamHub();
      let sent = 0;
      for (let index = 0; index < connections; index++) hub.connect({ send() { sent++; } });
      measure(`ws/broadcast/${connections}`, () => hub.broadcast({ type: 'server:stats', count: 100 }), { operations: 100 });
      expect(sent).toBe(connections * 2003);
    }
    diagnostics.controls = 'The 200-record text case matches production defaults. Large retention is a scaling probe. WebSocket sockets are no-op mocks, excluding network/backpressure.';
  });

  test('count and time sequential model requests through real planning workflows', async () => {
    const fixture = createMemoryFixture();
    const valid = JSON.stringify(createValidPlan());
    const badPlan = createValidPlan();
    badPlan.weeklySchedule.push({ ...structuredClone(badPlan.weeklySchedule[0]!), dayIndex: 3 });
    badPlan.weeklyFrequency = 2;
    const cases = [
      { name: 'valid', replies: [valid], expectedCalls: 1 },
      { name: 'normalization', replies: ['invalid JSON', valid], expectedCalls: 2 },
      { name: 'repair', replies: [JSON.stringify(badPlan), valid], expectedCalls: 2 },
      { name: 'tool-loop', replies: [toolReply, valid], expectedCalls: 2 },
      { name: 'image-tool-normalize-repair',
        replies: [JSON.stringify(visionResult), toolReply, 'invalid JSON', JSON.stringify(badPlan), valid],
        expectedCalls: 5, image: true },
    ];
    try {
      // Warm SDK imports/schema compilation outside the measured cases.
      await withModelReplies([valid], () => generateTrainingPlan({
        runtime: createTestRuntime(fixture.store), request: createPlanRequest(),
      }));
      const configuredLatencyMs = 20;
      for (const scenario of cases) {
        const times = [];
        const providerTimes = [];
        const requestBytes = [];
        for (let sample = 0; sample < 10; sample++) {
          const request = createPlanRequest();
          if (scenario.image) request.inputImages = [{ image: 'https://chatgym-test.invalid/image.png', detail: 'auto' }];
          const result = await withModelReplies(scenario.replies, () => generateTrainingPlan({
            runtime: createTestRuntime(fixture.store), request,
          }), configuredLatencyMs);
          expect(result.calls).toHaveLength(scenario.expectedCalls);
          expect(result.value.review.status).toBe('pass');
          times.push(result.elapsedMs);
          providerTimes.push(result.calls.reduce((sum, call) => sum + call.durationMs, 0));
          requestBytes.push(result.calls.reduce((sum, call) => sum + call.requestBytes, 0));
        }
        const latency = recordMeasurement(`agent/${scenario.name}`, times, 1, {
          modelCalls: scenario.expectedCalls, configuredLatencyMs,
          meanSimulatedProviderWaitMs: providerTimes.reduce((a, b) => a + b, 0) / providerTimes.length,
          meanModelRequestBytes: requestBytes.reduce((a, b) => a + b, 0) / requestBytes.length,
        });
        expect(latency.medianMs).toBeGreaterThan(0);
      }
      // Diagnose the upload-generated data URL separately; a failed input must
      // not masquerade as a fast successful image-planning benchmark.
      const request = createPlanRequest();
      request.inputImages = [{ image: testImageDataUrl, detail: 'auto' }];
      try {
        const result = await withModelReplies([JSON.stringify(visionResult), valid], () =>
          generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request }));
        diagnostics.dataUrlInput = { status: 'supported', calls: result.calls.length };
      } catch (error) {
        diagnostics.dataUrlInput = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    } finally { fixture.close(); }
  }, 30_000);

  test('diagnose SSE first event timing and work that continues after cancellation', async () => {
    const fixture = createMemoryFixture();
    try {
      const eventTimes: Array<{ type: string; atMs: number }> = [];
      const measured = await withModelReplies([JSON.stringify(createValidPlan())], async () => {
        const started = performance.now();
        await generateTrainingPlan({
          runtime: createTestRuntime(fixture.store), request: createPlanRequest(),
          onEvent: (event) => eventTimes.push({ type: event.type, atMs: performance.now() - started }),
        });
      }, 40);
      diagnostics.streamEvents = {
        events: eventTimes,
        firstTextMs: eventTimes.find((event) => event.type === 'text')?.atMs,
        finalMs: eventTimes.find((event) => event.type === 'final')?.atMs,
        modelCalls: measured.calls.length,
        note: 'Workflow callbacks occur at step completion; this is not a measurement of individual provider tokens.',
      };

      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      let completed = false;
      const response = createAgentSseResponse({
        onStart: async () => {
          try {
            await withModelReplies([JSON.stringify(createValidPlan())], async () => {
              await generateTrainingPlan({ runtime: createTestRuntime(fixture.store), request: createPlanRequest() });
            }, 40);
            completed = true;
          } finally { finish(); }
        },
      });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      await finished;
      diagnostics.sseCancellation = { workflowCompletedAfterCancel: completed };

      let release!: () => void;
      let producerFinished!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const producerDone = new Promise<void>((resolve) => { producerFinished = resolve; });
      const event: AgentConsoleEvent = {
        id: 'perf', requestId: 'perf', type: 'text', timestamp: new Date().toISOString(), summary: 'test', text: 'x'.repeat(1000),
      };
      const slowResponse = createAgentSseResponse({
        onStart: async (emit) => {
          await blocked;
          for (let index = 0; index < 1000; index++) emit(event);
          producerFinished();
        },
      });
      release();
      await producerDone;
      let chunks = 0;
      let bytes = 0;
      const slowReader = slowResponse.body!.getReader();
      while (true) {
        const part = await slowReader.read();
        if (part.done) break;
        chunks++;
        bytes += part.value.byteLength;
      }
      expect(chunks).toBe(1001);
      diagnostics.sseSlowConsumer = {
        chunksBufferedBeforeReading: chunks, bufferedPayloadBytes: bytes,
        note: 'Producer emitted all chunks before any body read; no consumer-driven backpressure in current adapter.',
      };
    } finally { fixture.close(); }
  }, 10_000);
});
