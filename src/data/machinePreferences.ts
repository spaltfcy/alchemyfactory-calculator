import type { AppSettings, MachinePreferences, Recipe } from '../types';

export const DEFAULT_MACHINE_PREFERENCES: MachinePreferences = {
  crucible: 'crucible',
  grinder: 'grinder',
  extractor: 'extractor',
};

export function getMachinePreferences(settings?: { machinePreferences?: Partial<MachinePreferences> }): MachinePreferences {
  return {
    ...DEFAULT_MACHINE_PREFERENCES,
    ...(settings?.machinePreferences ?? {}),
  };
}

export function getEffectiveRecipeMachineId(recipe: Recipe, settings: AppSettings): string {
  const preferences = getMachinePreferences(settings);
  if (recipe.machineId === 'crucible') return preferences.crucible;
  if (recipe.machineId === 'grinder') return preferences.grinder;
  if (recipe.machineId === 'extractor') return preferences.extractor;
  return recipe.machineId;
}

export function getEffectiveRecipeTimeSec(recipe: Recipe, settings: AppSettings): number {
  const preferences = getMachinePreferences(settings);
  if (recipe.machineId === 'grinder' && preferences.grinder === 'enhanced_grinder') {
    return recipe.timeSec / 2;
  }
  return recipe.timeSec;
}
