import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Measurement {
  name: string;
  samples: number;
  operationsPerSample: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  details: Record<string, unknown>;
}

export const measurements: Measurement[] = [];
export const diagnostics: Record<string, unknown> = {};

export const recordMeasurement = (
  name: string, times: number[], operationsPerSample = 1, details: Record<string, unknown> = {},
) => {
  const sorted = times.map((time) => time / operationsPerSample).sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('Measurements require at least one sample');
  const result: Measurement = {
    name, samples: sorted.length, operationsPerSample,
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    minMs: sorted[0]!, maxMs: sorted.at(-1)!, details,
  };
  measurements.push(result);
  return result;
};

export const measure = (
  name: string, operation: () => unknown,
  { samples = 20, operations = 1, details = {} }: {
    samples?: number; operations?: number; details?: Record<string, unknown>;
  } = {},
) => {
  for (let index = 0; index < 3; index++) operation();
  const times: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const started = performance.now();
    for (let index = 0; index < operations; index++) operation();
    times.push(performance.now() - started);
  }
  return recordMeasurement(name, times, operations, details);
};

// A queued timer cannot run while synchronous SQLite/serialization work runs.
// Report the raw delay; this includes timer scheduling overhead, not just the work.
export const timerDelayDuring = async (work: () => void) => {
  const started = performance.now();
  const timer = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - started), 0));
  work();
  return timer;
};

export const writePerformanceReport = async () => {
  const path = Bun.env.PERF_REPORT_PATH ?? '/tmp/chatgym-performance.json';
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: { bun: Bun.version, platform: process.platform, arch: process.arch },
    methodology: {
      timing: 'Milliseconds per operation; batched samples report batch averages, including p95.',
      warmup: 'Three untimed warmup calls for synchronous benchmarks.',
      model: 'Simulated HTTP responses with configured latency; no real provider calls.',
      scope: 'In-process application benchmarks; excludes network load and real model inference.',
    },
    measurements, diagnostics,
  }, null, 2));
  console.table(measurements.map(({ name, medianMs, p95Ms, details }) => ({
    name, medianMs: Number(medianMs.toFixed(3)), p95Ms: Number(p95Ms.toFixed(3)),
    ...(details.modelCalls === undefined ? {} : { modelCalls: details.modelCalls }),
  })));
  console.log(`Performance report: ${path}`);
};
