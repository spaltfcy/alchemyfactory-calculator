import type { Recipe } from '../types';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { itemById } from '../data/items';

export type ItemSourceResolution =
  | { kind: 'recipe'; itemId: string; recipe: Recipe }
  | { kind: 'purchase'; itemId: string }
  | { kind: 'unresolved'; itemId: string; reason: 'no_recipe_or_buy_price' | 'blocked_or_invalid_recipe' };

export type ItemSourceResolverContext = {
  recipePreferences: Record<string, string>;
  blockedRecipeIds?: Set<string>;
  isRecipeAllowed?: (recipe: Recipe) => boolean;
};

export function isBuyableItem(itemId: string): boolean {
  return itemById[itemId]?.buyPriceCopper !== undefined;
}

export function getRecipeCandidatesForItem(itemId: string, recipePreferences: Record<string, string>): Recipe[] {
  const candidates: Recipe[] = [];
  const preferred = recipePreferences[itemId];
  if (preferred && recipeById[preferred]) candidates.push(recipeById[preferred]);
  const defaultRecipeId = DEFAULT_RECIPE_BY_ITEM_ID[itemId];
  if (defaultRecipeId && recipeById[defaultRecipeId]) candidates.push(recipeById[defaultRecipeId]);
  candidates.push(...getRecipesProducing(itemId));

  const seen = new Set<string>();
  return candidates.filter((recipe) => {
    if (!recipe || seen.has(recipe.id)) return false;
    seen.add(recipe.id);
    return true;
  });
}

export function resolveItemSource(itemId: string, context: ItemSourceResolverContext): ItemSourceResolution {
  let hadBlockedOrInvalidRecipe = false;
  for (const recipe of getRecipeCandidatesForItem(itemId, context.recipePreferences)) {
    if (context.blockedRecipeIds?.has(recipe.id)) {
      hadBlockedOrInvalidRecipe = true;
      continue;
    }
    if (context.isRecipeAllowed && !context.isRecipeAllowed(recipe)) {
      hadBlockedOrInvalidRecipe = true;
      continue;
    }
    return { kind: 'recipe', itemId, recipe };
  }

  if (isBuyableItem(itemId)) return { kind: 'purchase', itemId };
  return {
    kind: 'unresolved',
    itemId,
    reason: hadBlockedOrInvalidRecipe ? 'blocked_or_invalid_recipe' : 'no_recipe_or_buy_price',
  };
}

export function chooseRecipeForItem(itemId: string, recipePreferences: Record<string, string>): Recipe | undefined {
  const resolved = resolveItemSource(itemId, { recipePreferences });
  return resolved.kind === 'recipe' ? resolved.recipe : undefined;
}
