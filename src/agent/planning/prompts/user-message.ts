import type { ModelMessage } from 'ai';
import type { PlanRequestInput, ProgrammingConstraint, RetrievedMemory } from '../../shared/types';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';
import type { PlanningInteractionMode } from '../interaction-mode';

export const planningOutputContract = `
Return only one JSON object. Do not wrap it in markdown fences.

Language requirements:
- All human-readable strings must be in Simplified Chinese.
- Keep schema-required enum literals exactly as required, including "1_week", "2_weeks", "4_weeks", "low", "medium", and "high".

Required top-level fields:
- title
- objective
- planHorizon: one of "1_week", "2_weeks", "4_weeks"
- weeklyFrequency
- summary
- suitability
- weeklySchedule
- progressionRules
- recoveryGuidance
- metricsToTrack
- warnings

Session shape requirements:
- weeklySchedule is an array of sessions.
- suitability must contain only whyItFits: string[] and riskControls: string[].
- Each session must contain dayIndex, dayLabel, focus, goal, intensity, durationMinutes, warmup, mainBlocks, cooldown, notes, recoveryWindowHours.
- intensity must be one of "low", "medium", "high".
- warmup, cooldown, notes, progressionRules, recoveryGuidance, metricsToTrack must all be arrays of strings.
- Each main block must contain title, purpose, exercises.
- Each session should usually use 2-3 main blocks and no more than 5 total exercises across all mainBlocks.
- Each exercise must contain name, sets, reps, restSeconds, intensity, primaryMuscles, coachingCue, alternatives.
- sets and reps must both be JSON integers.
- Never output range strings such as "8-10" or "10-12" for sets or reps.
- Exercise name and alternatives must use only the supported frontend exercise names listed below.
`.trim();

export const buildPlanningMessages = ({
  request,
  interactionMode,
  memoryPreview,
  programmingConstraints,
  imageContextSummary,
  imageContextNotes,
  foodCalorieContext,
  foodCaloriePrompt,
}: {
  request: PlanRequestInput;
  interactionMode: PlanningInteractionMode;
  memoryPreview: RetrievedMemory[];
  programmingConstraints: ProgrammingConstraint;
  imageContextSummary?: string | null;
  imageContextNotes?: string[];
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
}): ModelMessage[] => {
  const { chatHistory = [], ...currentRequest } = request;
  const historyMessages: ModelMessage[] = chatHistory.map(({ role, text }) => ({
    role,
    content: text,
  }));
  const text = `
Create a detailed weekly training plan for this user.

Frontend payload:
${JSON.stringify(currentRequest, null, 2)}

Interaction mode:
${interactionMode}

Relevant workout history preview:
${JSON.stringify(memoryPreview, null, 2)}

Deterministic programming constraints:
${JSON.stringify(programmingConstraints, null, 2)}

Image analysis summary:
${imageContextSummary ?? 'No image analysis was provided.'}

Image-derived training notes:
${JSON.stringify(imageContextNotes ?? [], null, 2)}

Food calorie context from image analysis:
${foodCalorieContext ?? 'No food calorie context was provided.'}

Food-related image prompt:
${foodCaloriePrompt ?? 'No food-related image prompt was provided.'}

Planning expectations:
- Keep the plan realistic for the user's schedule.
- Make exercise choices coherent with equipment and experience.
- Use the workout history preview to avoid repeating obviously stale or poorly recovered patterns.
- Treat all prior chat messages as conversation context, not durable memory facts. Answer the current user text in goal.requestNote; previous assistant messages are suggestions, not user-stated facts.
- Use the deterministic programming constraints as the default guardrails for volume, intensity, progression, and recovery.
- Keep each session concise: usually 2-3 main blocks and no more than 5 total main exercises.
- Use the image analysis only as supporting context.
- If food calorie context is present, use it as supporting nutrition context for training load, recovery guidance, and metrics to track.
- Exercise sets and reps must both be JSON integers.
- Never output range strings such as "8-10" or "10-12" for sets or reps.
- All human-readable strings in the final JSON must be Simplified Chinese.
- Keep schema-required enum literals exactly as required, including "1_week", "2_weeks", "4_weeks", "low", "medium", and "high".
- Do not call tools to restate information already present in the frontend payload, workout history preview, or deterministic programming constraints.
- ${interactionMode === 'dialog'
    ? 'Dialog mode: default to zero tool calls. Use at most one tool call only when it materially improves safety or exercise matching.'
    : 'Plan mode: keep tool usage minimal and only use a tool when the supplied context is still insufficient.'}
${interactionMode === 'dialog'
  ? '- Answer the current question directly in Simplified Chinese plain text; do not produce weekly-plan JSON.'
  : `- The final answer must satisfy this output contract:\n${planningOutputContract}`}

Supported exercise set:
${SUPPORTED_EXERCISE_GUIDANCE}
`.trim();

  return [
    ...historyMessages,
    {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  ];
};
