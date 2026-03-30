import { tool } from 'ai';
import { z } from 'zod';
import { findFoodReference } from '../../shared/food-calorie-catalog';
import { lookupEquipmentFromCatalog } from '../../shared/equipment-catalog';
import { calorieEstimateItemSchema, equipmentKnowledgeSchema } from '../../shared/types';

const normalizeToken = (value: string) => value.toLowerCase().trim();

const inferPortionFactor = (portionEstimate: string) => {
  const normalized = normalizeToken(portionEstimate);

  if (normalized.includes('half')) {
    return 0.5;
  }

  if (normalized.includes('small')) {
    return 0.75;
  }

  if (normalized.includes('large') || normalized.includes('big')) {
    return 1.5;
  }

  if (normalized.includes('double')) {
    return 2;
  }

  return 1;
};

const resolveFoodReference = (itemName: string) => {
  const direct = findFoodReference(itemName);

  if (direct) {
    return direct;
  }

  const normalized = normalizeToken(itemName);

  return [
    'white rice',
    'chicken breast',
    'beef',
    'salmon',
    'egg',
    'banana',
    'apple',
    'bread',
    'milk tea',
    'fries',
    'pizza',
    'noodles',
    'oatmeal',
    'yogurt',
    'protein shake',
  ]
    .map((name) => findFoodReference(name))
    .find((candidate) =>
      candidate
        ? [candidate.name, ...candidate.aliases].some((value) => normalized.includes(normalizeToken(value)))
        : false,
    );
};

export const createVlmTools = () => ({
  estimateFoodCalories: tool({
    description:
      'Estimate food calories from a list of identified foods and rough portion descriptions. Returns calorie ranges and assumptions.',
    inputSchema: z.object({
      items: z.array(
        z.object({
          name: z.string().min(1),
          portionEstimate: z.string().min(1),
          quantity: z.number().positive().max(10).optional(),
          grams: z.number().positive().max(5000).optional(),
        }),
      ),
    }),
    execute: async ({ items }) => {
      const estimatedItems = items.map((item) => {
        const reference = resolveFoodReference(item.name);
        const factor =
          item.grams && reference?.gramsPerServing
            ? item.grams / reference.gramsPerServing
            : item.quantity ?? inferPortionFactor(item.portionEstimate);
        const baseCalories = reference?.caloriesPerServing ?? 180;
        const estimated = Math.max(30, Math.round(baseCalories * factor));
        const lower = Math.max(0, Math.round(estimated * 0.8));
        const upper = Math.max(lower, Math.round(estimated * 1.2));

        return calorieEstimateItemSchema.parse({
          name: item.name,
          portionEstimate: item.portionEstimate,
          caloriesLow: lower,
          caloriesHigh: upper,
          confidence: reference ? 'medium' : 'low',
          assumptions: [
            reference
              ? `Matched to reference serving ${reference.servingDescription}.`
              : 'No exact reference match was found, so a generic meal estimate was used.',
          ],
        });
      });

      return {
        items: estimatedItems,
        totalCaloriesLow: estimatedItems.reduce((sum, item) => sum + item.caloriesLow, 0),
        totalCaloriesHigh: estimatedItems.reduce((sum, item) => sum + item.caloriesHigh, 0),
      };
    },
  }),
  lookupFitnessEquipment: tool({
    description:
      'Look up likely equipment or machine matches from a built-in gym equipment catalog using a free-text query.',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, limit }) => ({
      matches: z.array(equipmentKnowledgeSchema).parse(lookupEquipmentFromCatalog(query, limit)),
    }),
  }),
});

export type VlmTools = ReturnType<typeof createVlmTools>;
