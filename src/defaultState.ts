import type { AppState } from './types';
import { DEFAULT_ABILITIES } from './data/abilityTables';

export const DEFAULT_STATE: AppState = {
  version: 18,
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
    graphDetailLevel: 'normal',
    showSurplus: true,
    showDiscardedByproducts: true,
    showCompleted: true,
    fuel: {
      enabled: true,
      fuelItemId: 'charcoal_powder',
      fuelSourceMode: 'craft',
      crucibleVariant: 'crucible',
      crucibleOverheadHeatPerSec: 0.4,
      otherOverheadHeatPerSec: 1,
      maxIterations: 8,
    },
  },
  abilities: DEFAULT_ABILITIES,
  recipePreferences: {},
  surplusPolicies: {},
  itemSourceModes: {},
  completedGraphNodeIds: {},
  nodeNotes: {},
};
