import type { ZodType } from 'zod';

const stripCodeFence = (text: string) => {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  const fencedContent = fencedMatch?.[1];

  return fencedContent ? fencedContent.trim() : trimmed;
};

const tryParseCandidate = (candidate: string) => {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
};

const extractJsonObjectCandidate = (text: string) => {
  const normalized = stripCodeFence(text);
  const direct = tryParseCandidate(normalized);

  if (direct !== undefined) {
    return normalized;
  }

  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0 && startIndex >= 0) {
        const candidate = normalized.slice(startIndex, index + 1);

        if (tryParseCandidate(candidate) !== undefined) {
          return candidate;
        }
      }
    }
  }

  return normalized;
};

export const parseJsonValueFromModelText = (text: string, label: string) => {
  const candidate = extractJsonObjectCandidate(text);

  try {
    return JSON.parse(candidate) as unknown;
  } catch (error) {
    const preview = text.trim().slice(0, 500);
    const errorMessage = error instanceof Error ? error.message : 'unknown parse error';

    throw new Error(`Failed to parse ${label} JSON from model output: ${errorMessage}. Raw preview: ${preview}`);
  }
};

export const parseJsonObjectFromModelText = <T>(
  text: string,
  schema: ZodType<T>,
  label: string,
) => {
  try {
    return schema.parse(parseJsonValueFromModelText(text, label));
  } catch (error) {
    const preview = text.trim().slice(0, 500);
    const errorMessage = error instanceof Error ? error.message : 'unknown parse error';

    throw new Error(`Failed to parse ${label} JSON from model output: ${errorMessage}. Raw preview: ${preview}`);
  }
};
