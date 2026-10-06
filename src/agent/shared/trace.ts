import type { WorkflowTraceStep } from './types';

export const summarizeToolPayload = (value: unknown): string => {
  const raw = JSON.stringify(value);

  if (!raw) {
    return '空结果';
  }

  return raw.length <= 180 ? raw : `${raw.slice(0, 177)}...`;
};

export const timestampedTrace = (
  stage: string,
  status: WorkflowTraceStep['status'],
  summary: string,
  details?: Record<string, unknown>,
): WorkflowTraceStep => ({
  stage,
  status,
  timestamp: new Date().toISOString(),
  summary,
  details,
});
