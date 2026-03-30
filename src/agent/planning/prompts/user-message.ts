import type { ModelMessage } from 'ai';
import type { PlanRequestInput, RetrievedMemory } from '../../shared/types';
import { SUPPORTED_EXERCISE_GUIDANCE } from '../../shared/training-taxonomy';

export const buildPlanningMessages = ({
  request,
  memoryPreview,
  imageContextSummary,
  imageContextNotes,
  foodCalorieContext,
  foodCaloriePrompt,
}: {
  request: PlanRequestInput;
  memoryPreview: RetrievedMemory[];
  imageContextSummary?: string | null;
  imageContextNotes?: string[];
  foodCalorieContext?: string | null;
  foodCaloriePrompt?: string | null;
}): ModelMessage[] => {
  const text = `
Create a detailed weekly training plan for this user.

Frontend payload:
${JSON.stringify(request, null, 2)}

Relevant workout history preview:
${JSON.stringify(memoryPreview, null, 2)}

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
- Use the image analysis only as supporting context.
- If food calorie context is present, use it as supporting nutrition context for training load, recovery guidance, and metrics to track.
- If more history detail or better exercise matching is needed, call the tools.
- The final answer must be the structured output only.

Supported exercise set:
${SUPPORTED_EXERCISE_GUIDANCE}
`.trim();

  return [
    {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  ];
};
