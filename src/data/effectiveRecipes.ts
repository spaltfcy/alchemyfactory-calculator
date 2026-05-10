import type { AppSettings, ItemRecipeInput, Recipe, RecipeInput } from '../types';
import { itemById } from './items';
import { getMachinePreferences } from './machinePreferences';
import { DEFAULT_PARADOX_SETTINGS, getParadoxSettings, isParadoxableItem } from './paradox';

export type EffectiveRecipe = Omit<Recipe, 'inputs'> & { inputs: ItemRecipeInput[] };

export function isItemRecipeInput(input: RecipeInput): input is ItemRecipeInput {
  return input.kind !== 'paradoxableItem';
}

export function isParadoxableRecipeInput(input: RecipeInput): boolean {
  return input.kind === 'paradoxableItem';
}

export function getSelectedParadoxInputItemId(settings: AppSettings): string {
  const preferred = getParadoxSettings(settings).oblivionInputItemId;
  return isParadoxableItem(preferred) ? preferred : DEFAULT_PARADOX_SETTINGS.oblivionInputItemId;
}

function selectedParadoxTimeSec(settings: AppSettings): number {
  const itemId = getSelectedParadoxInputItemId(settings);
  const timeSec = itemById[itemId]?.paradoxTimeSec;
  if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec <= 0) {
    throw new Error('Invalid paradox input item: ' + itemId);
  }
  return timeSec;
}

export function getResolvedRecipeInputs(recipe: Recipe, settings: AppSettings): ItemRecipeInput[] {
  return recipe.inputs.map((entry) => {
    if (isItemRecipeInput(entry)) return { kind: 'item', itemId: entry.itemId, amount: entry.amount };
    return { kind: 'item', itemId: getSelectedParadoxInputItemId(settings), amount: entry.amount };
  });
}

export function getEffectiveRecipeMachineId(recipe: Recipe, settings: AppSettings): string {
  const preferences = getMachinePreferences(settings);
  if (recipe.machineId === 'crucible') return preferences.crucible;
  if (recipe.machineId === 'grinder') return preferences.grinder;
  return recipe.machineId;
}

export function getEffectiveRecipeTimeSec(recipe: Recipe, settings: AppSettings): number {
  const hasParadoxInput = recipe.inputs.some(isParadoxableRecipeInput);
  if (hasParadoxInput) return selectedParadoxTimeSec(settings);

  const preferences = getMachinePreferences(settings);
  if (recipe.machineId === 'grinder' && preferences.grinder === 'enhanced_grinder') {
    return recipe.timeSec / 2;
  }
  return recipe.timeSec;
}

export function getEffectiveRecipeForCalculation(recipe: Recipe, settings: AppSettings): EffectiveRecipe {
  return {
    ...recipe,
    inputs: getResolvedRecipeInputs(recipe, settings),
    timeSec: getEffectiveRecipeTimeSec(recipe, settings),
  };
}
