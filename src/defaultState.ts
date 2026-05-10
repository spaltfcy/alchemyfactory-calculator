import type { AppState } from './types';
import { DEFAULT_ABILITIES } from './data/abilityTables';
import { DEFAULT_MACHINE_PREFERENCES } from './data/machinePreferences';
import { DEFAULT_PARADOX_SETTINGS } from './data/paradox';

export const DEFAULT_STATE: AppState = {
  version: 26,
  language: 'ja',
  activeTab: 'graph',
  targets: [
    {
      id: 'target-1',
      recipeId: 'charcoal_powder_from_charcoal',
      outputItemId: 'charcoal_powder',
      mode: 'rate',
      value: 30,
    },
  ],
  settings: {
    machineRounding: 'none',
    defaultSurplusPolicy: 'reuse',
    showSurplus: true,
    showDiscardedByproducts: true,
    showCompleted: true,
    showInitialInvestmentLines: true,
    allowAlternateRecipeCompletion: false,
    useByproductFuel: false,
    machinePreferences: DEFAULT_MACHINE_PREFERENCES,
    paradox: DEFAULT_PARADOX_SETTINGS,
    fuel: {
      enabled: true,
      fuelItemId: 'charcoal_powder',
      sourceMode: 'internal',
      heatingMode: 'direct',
      maxIterations: 16,
    },
    fertilizer: {
      enabled: true,
      fertilizerItemId: 'basic_fertilizer',
      sourceMode: 'internal',
      maxIterations: 4,
    },
  },
  abilities: DEFAULT_ABILITIES,
  recipePreferences: {
    coke: 'coke',
    emerald: 'emerald',
    sapphire: 'sapphire',
    ruby: 'ruby',
    adamant: 'adamant',
    obsidian: 'obsidian_and_volcanic_ash',
    iron_sand: 'iron_sand',
    shattered_crystal: 'shattered_crystal',
    salt: 'salt_and_sand_2',
    sand: 'sand',
    copper_powder: 'copper_powder_and_impure_copper_powder',
    gold_dust: 'gold_dust',
    impure_gold_dust: 'impure_gold_dust',
    steam: 'steam_boiler_high',
  },
  surplusPolicies: {},
  completedGraphNodeIds: {},
  nodeNotes: {},
};
