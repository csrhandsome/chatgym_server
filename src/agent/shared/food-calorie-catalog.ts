export interface FoodCalorieReference {
  readonly name: string;
  readonly aliases: string[];
  readonly servingDescription: string;
  readonly caloriesPerServing: number;
  readonly gramsPerServing?: number;
}

const normalizeToken = (value: string) => value.toLowerCase().trim();

export const FOOD_CALORIE_REFERENCE: FoodCalorieReference[] = [
  { name: 'white rice', aliases: ['rice', '米饭'], servingDescription: '1 bowl', caloriesPerServing: 260, gramsPerServing: 200 },
  { name: 'chicken breast', aliases: ['grilled chicken', '鸡胸肉'], servingDescription: '100 g', caloriesPerServing: 165, gramsPerServing: 100 },
  { name: 'beef', aliases: ['steak', '牛肉'], servingDescription: '100 g', caloriesPerServing: 250, gramsPerServing: 100 },
  { name: 'salmon', aliases: ['三文鱼'], servingDescription: '100 g', caloriesPerServing: 208, gramsPerServing: 100 },
  { name: 'egg', aliases: ['boiled egg', 'fried egg', '鸡蛋'], servingDescription: '1 large egg', caloriesPerServing: 78 },
  { name: 'banana', aliases: ['香蕉'], servingDescription: '1 medium', caloriesPerServing: 105 },
  { name: 'apple', aliases: ['苹果'], servingDescription: '1 medium', caloriesPerServing: 95 },
  { name: 'bread', aliases: ['toast', '面包'], servingDescription: '2 slices', caloriesPerServing: 160 },
  { name: 'milk tea', aliases: ['bubble tea', '奶茶'], servingDescription: '1 medium cup', caloriesPerServing: 350 },
  { name: 'fries', aliases: ['french fries', '薯条'], servingDescription: '1 medium portion', caloriesPerServing: 340 },
  { name: 'pizza', aliases: ['pizza slice', '披萨'], servingDescription: '2 slices', caloriesPerServing: 570 },
  { name: 'noodles', aliases: ['面条', 'ramen'], servingDescription: '1 bowl', caloriesPerServing: 420 },
  { name: 'oatmeal', aliases: ['燕麦'], servingDescription: '1 bowl', caloriesPerServing: 180 },
  { name: 'yogurt', aliases: ['酸奶'], servingDescription: '1 cup', caloriesPerServing: 150 },
  { name: 'protein shake', aliases: ['shake'], servingDescription: '1 bottle', caloriesPerServing: 180 },
];

export const findFoodReference = (itemName: string) => {
  const normalized = normalizeToken(itemName);

  return FOOD_CALORIE_REFERENCE.find((reference) => {
    if (normalizeToken(reference.name) === normalized) {
      return true;
    }

    return reference.aliases.some((alias) => normalizeToken(alias) === normalized);
  });
};
