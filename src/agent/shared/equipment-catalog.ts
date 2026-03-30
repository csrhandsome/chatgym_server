import type { z } from 'zod';
import { equipmentKnowledgeSchema } from './types';
import { tokenizeTrainingText } from './training-taxonomy';

export type EquipmentKnowledge = z.infer<typeof equipmentKnowledgeSchema>;

export const EQUIPMENT_CATALOG: EquipmentKnowledge[] = [
  {
    name: 'Treadmill',
    category: 'cardio machine',
    likelyExercises: ['跑步机', '坡度走', '热身慢走'],
    targetMuscles: ['cardio', 'glutes', 'calves'],
    safetyNotes: ['Start with low speed before stepping on.', 'Use incline carefully if calves are tight.'],
  },
  {
    name: 'Stationary Bike',
    category: 'cardio machine',
    likelyExercises: ['steady-state ride', 'interval ride', 'warmup'],
    targetMuscles: ['cardio', 'quadriceps', 'glutes'],
    safetyNotes: ['Adjust seat height so the knee stays slightly bent at the bottom.'],
  },
  {
    name: 'Elliptical',
    category: 'cardio machine',
    likelyExercises: ['steady-state cardio', 'low-impact intervals'],
    targetMuscles: ['cardio', 'glutes', 'quadriceps'],
    safetyNotes: ['Keep posture tall and avoid leaning heavily on the handles.'],
  },
  {
    name: 'Cable Machine',
    category: 'strength machine',
    likelyExercises: ['龙门架夹胸', '高位下拉', '坐姿划船'],
    targetMuscles: ['chest', 'back', 'arms'],
    safetyNotes: ['Set pin securely before pulling.', 'Use a stable stance for unilateral work.'],
  },
  {
    name: 'Smith Machine',
    category: 'guided barbell machine',
    likelyExercises: ['杠铃深蹲', '卧推', '臀桥'],
    targetMuscles: ['quadriceps', 'glutes', 'chest'],
    safetyNotes: ['Check the hook rotation before unracking.', 'Do not assume the bar path fits every body.'],
  },
  {
    name: 'Leg Press',
    category: 'lower-body machine',
    likelyExercises: ['leg press', 'single-leg press'],
    targetMuscles: ['quadriceps', 'glutes', 'hamstrings'],
    safetyNotes: ['Do not bottom out into lumbar rounding.', 'Use a pain-free depth if knees are sensitive.'],
  },
  {
    name: 'Lat Pulldown Machine',
    category: 'upper-body machine',
    likelyExercises: ['高位下拉'],
    targetMuscles: ['lats', 'biceps', 'mid back'],
    safetyNotes: ['Avoid yanking with momentum.', 'Keep shoulders down rather than shrugged.'],
  },
  {
    name: 'Seated Row Machine',
    category: 'upper-body machine',
    likelyExercises: ['坐姿划船'],
    targetMuscles: ['mid back', 'lats', 'biceps'],
    safetyNotes: ['Do not overextend the lower back at the finish.'],
  },
  {
    name: 'Chest Press Machine',
    category: 'upper-body machine',
    likelyExercises: ['machine chest press'],
    targetMuscles: ['chest', 'triceps', 'front delts'],
    safetyNotes: ['Set seat height so handles line up around mid-chest.'],
  },
  {
    name: 'Adjustable Bench',
    category: 'free-weight station',
    likelyExercises: ['卧推', '哑铃划船', '臀桥'],
    targetMuscles: ['chest', 'front delts', 'mid back'],
    safetyNotes: ['Lock the bench angle before loading dumbbells.'],
  },
  {
    name: 'Dumbbells',
    category: 'free weights',
    likelyExercises: ['哑铃弯举', '哑铃划船'],
    targetMuscles: ['full body'],
    safetyNotes: ['Choose a manageable load and keep clear floor space before lifting.'],
  },
  {
    name: 'Barbell',
    category: 'free weights',
    likelyExercises: ['杠铃深蹲', '卧推', '臀桥'],
    targetMuscles: ['full body'],
    safetyNotes: ['Use collars when needed and set rack height correctly before unracking.'],
  },
];

export const lookupEquipmentFromCatalog = (query: string, limit = 6): EquipmentKnowledge[] => {
  const queryTokens = new Set(tokenizeTrainingText(query));

  return EQUIPMENT_CATALOG
    .map((item) => {
      const itemTokens = new Set(
        [item.name, item.category, ...item.likelyExercises, ...item.targetMuscles].flatMap(
          tokenizeTrainingText,
        ),
      );
      const score = [...queryTokens].filter((token) => itemTokens.has(token)).length;

      return {
        item,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
};
