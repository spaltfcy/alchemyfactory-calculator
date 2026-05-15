import { ITEMS, itemById } from './items';
import { MACHINES, machineById } from './machines';
import {
  RECIPES,
  getRecipesProducing,
  recipeExpectedOutputAmountPerRun,
  recipeInputAmountPerRun,
  recipeItemIds,
  recipeRateBalancePerRun,
} from './recipes';

const EPS = 1e-9;

export type RecipeDataAudit = {
  counts: {
    items: number;
    machines: number;
    recipes: number;
    sellableItems: number;
    buyableItems: number;
    probabilityRecipes: number;
    sameItemInputOutputRecipes: number;
    extractorRecipes: number;
    distillerRecipes: number;
    alchemyAffectedRecipes: number;
    unknownItemRefs: number;
    unknownMachineRefs: number;
    invalidProbabilityRefs: number;
    invalidAmountRefs: number;
    duplicateItemIds: number;
    duplicateMachineIds: number;
    duplicateRecipeIds: number;
    machinePortViolations: number;
  };
  probabilityRecipeIds: string[];
  sameItemInputOutputRecipeIds: string[];
  extractorRecipeIds: string[];
  distillerRecipeIds: string[];
  alchemyAffectedRecipeIds: string[];
  unknownItemRefs: Array<{ recipeId: string; direction: 'input' | 'output'; itemId: string }>;
  unknownMachineRefs: Array<{ recipeId: string; machineId: string }>;
  invalidProbabilityRefs: Array<{ recipeId: string; itemId: string; probability: number }>;
  invalidAmountRefs: Array<{ ownerId: string; field: string; amount: number }>;
  duplicateItemIds: string[];
  duplicateMachineIds: string[];
  duplicateRecipeIds: string[];
  sameItemInputOutput: Array<{
    recipeId: string;
    itemId: string;
    inputPerRun: number;
    expectedOutputPerRun: number;
    netPerRun: number;
    producer: boolean;
  }>;
  probabilityRecipes: Array<{
    recipeId: string;
    outputs: Array<{ itemId: string; amount: number; probability: number; expectedAmountPerRun: number }>;
  }>;
  netNonPositiveOutputRecipes: Array<{ recipeId: string; itemId: string; netPerRun: number }>;
  producerIndexChecks: Array<{ itemId: string; producerRecipeIds: string[] }>;
  priceCoverage: {
    sellableItemIds: string[];
    buyableItemIds: string[];
    producedItemIdsWithoutSellPrice: string[];
    buyableAndCraftableItemIds: string[];
    internalItemsWithPrice: string[];
    negativePriceItemIds: string[];
  };
  machinePortViolations: Array<{
    recipeId: string;
    machineId: string;
    solidInputs: number;
    liquidInputs: number;
    solidOutputs: number;
    liquidOutputs: number;
    ports: { solidInputs: number; liquidInputs: number; solidOutputs: number; liquidOutputs: number };
  }>;
};

function duplicateIds(ids: string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort((a, b) => a.localeCompare(b));
}

function isProbabilityRecipe(recipeId: string): boolean {
  const recipe = RECIPES.find((entry) => entry.id === recipeId);
  return Boolean(recipe?.outputs.some((output) => output.probability !== undefined));
}

export function buildRecipeDataAudit(): RecipeDataAudit {
  const itemIds = new Set(ITEMS.map((item) => item.id));
  const machineIds = new Set(MACHINES.map((machine) => machine.id));
  const unknownItemRefs: RecipeDataAudit['unknownItemRefs'] = [];
  const unknownMachineRefs: RecipeDataAudit['unknownMachineRefs'] = [];
  const invalidProbabilityRefs: RecipeDataAudit['invalidProbabilityRefs'] = [];
  const invalidAmountRefs: RecipeDataAudit['invalidAmountRefs'] = [];
  const sameItemInputOutput: RecipeDataAudit['sameItemInputOutput'] = [];
  const probabilityRecipes: RecipeDataAudit['probabilityRecipes'] = [];
  const netNonPositiveOutputRecipes: RecipeDataAudit['netNonPositiveOutputRecipes'] = [];
  const machinePortViolations: RecipeDataAudit['machinePortViolations'] = [];

  for (const item of ITEMS) {
    if (item.sellPriceCopper !== undefined && (!Number.isFinite(item.sellPriceCopper) || item.sellPriceCopper < 0)) {
      invalidAmountRefs.push({ ownerId: item.id, field: 'sellPriceCopper', amount: Number(item.sellPriceCopper) });
    }
    if (item.buyPriceCopper !== undefined && (!Number.isFinite(item.buyPriceCopper) || item.buyPriceCopper < 0)) {
      invalidAmountRefs.push({ ownerId: item.id, field: 'buyPriceCopper', amount: Number(item.buyPriceCopper) });
    }
  }

  for (const recipe of RECIPES) {
    if (!machineIds.has(recipe.machineId)) unknownMachineRefs.push({ recipeId: recipe.id, machineId: recipe.machineId });
    if (recipe.id !== 'oblivion_essence' && (!Number.isFinite(recipe.timeSec) || recipe.timeSec <= 0)) invalidAmountRefs.push({ ownerId: recipe.id, field: 'timeSec', amount: Number(recipe.timeSec) });
    if (recipe.outputs.length === 0) invalidAmountRefs.push({ ownerId: recipe.id, field: 'outputs.length', amount: 0 });

    const inputItemIds = new Set<string>();
    const outputItemIds = new Set<string>();
    for (const input of recipe.inputs) {
      if (input.kind === 'paradoxableItem') {
        if (!Number.isFinite(input.amount) || input.amount <= 0) invalidAmountRefs.push({ ownerId: recipe.id, field: 'paradoxableInput.amount', amount: Number(input.amount) });
        continue;
      }
      inputItemIds.add(input.itemId);
      if (!itemIds.has(input.itemId)) unknownItemRefs.push({ recipeId: recipe.id, direction: 'input', itemId: input.itemId });
      if (!Number.isFinite(input.amount) || input.amount <= 0) invalidAmountRefs.push({ ownerId: recipe.id, field: `input.${input.itemId}`, amount: Number(input.amount) });
    }
    const probabilityOutputs: RecipeDataAudit['probabilityRecipes'][number]['outputs'] = [];
    for (const output of recipe.outputs) {
      outputItemIds.add(output.itemId);
      if (!itemIds.has(output.itemId)) unknownItemRefs.push({ recipeId: recipe.id, direction: 'output', itemId: output.itemId });
      if (!Number.isFinite(output.amount) || output.amount <= 0) invalidAmountRefs.push({ ownerId: recipe.id, field: `output.${output.itemId}`, amount: Number(output.amount) });
      const probability = output.probability ?? 1;
      if (!Number.isFinite(probability) || probability <= 0 || probability > 1) invalidProbabilityRefs.push({ recipeId: recipe.id, itemId: output.itemId, probability: Number(probability) });
      if (output.probability !== undefined) probabilityOutputs.push({ itemId: output.itemId, amount: output.amount, probability, expectedAmountPerRun: output.amount * probability });
      const net = recipeRateBalancePerRun(recipe, output.itemId);
      if (net <= EPS) netNonPositiveOutputRecipes.push({ recipeId: recipe.id, itemId: output.itemId, netPerRun: net });
    }
    if (probabilityOutputs.length > 0) probabilityRecipes.push({ recipeId: recipe.id, outputs: probabilityOutputs });
    for (const itemId of [...inputItemIds].filter((itemId) => outputItemIds.has(itemId)).sort((a, b) => a.localeCompare(b))) {
      const inputPerRun = recipeInputAmountPerRun(recipe, itemId);
      const expectedOutputPerRun = recipeExpectedOutputAmountPerRun(recipe, itemId);
      const netPerRun = expectedOutputPerRun - inputPerRun;
      sameItemInputOutput.push({ recipeId: recipe.id, itemId, inputPerRun, expectedOutputPerRun, netPerRun, producer: netPerRun > EPS });
    }

    const machine = machineById[recipe.machineId];
    if (machine) {
      const counts = recipeItemIds(recipe).reduce((acc, itemId) => {
        const item = itemById[itemId];
        if (!item) return acc;
        const isOutput = recipe.outputs.some((output) => output.itemId === itemId);
        const isInput = recipe.inputs.some((input) => input.kind !== 'paradoxableItem' && input.itemId === itemId);
        if (isInput) {
          if (item.physicalState === 'liquid') acc.liquidInputs += 1;
          else acc.solidInputs += 1;
        }
        if (isOutput) {
          if (item.physicalState === 'liquid') acc.liquidOutputs += 1;
          else acc.solidOutputs += 1;
        }
        return acc;
      }, { solidInputs: 0, liquidInputs: 0, solidOutputs: 0, liquidOutputs: 0 });
      const ports = machine.ports;
      if (counts.solidInputs > ports.solidInputs || counts.liquidInputs > ports.liquidInputs || counts.solidOutputs > ports.solidOutputs || counts.liquidOutputs > ports.liquidOutputs) {
        machinePortViolations.push({ recipeId: recipe.id, machineId: recipe.machineId, ...counts, ports });
      }
    }
  }

  const probabilityRecipeIds = probabilityRecipes.map((entry) => entry.recipeId).sort((a, b) => a.localeCompare(b));
  const sameItemInputOutputRecipeIds = [...new Set(sameItemInputOutput.map((entry) => entry.recipeId))].sort((a, b) => a.localeCompare(b));
  const extractorRecipeIds = RECIPES.filter((recipe) => recipe.machineId === 'extractor').map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b));
  const distillerRecipeIds = RECIPES.filter((recipe) => recipe.machineId === 'alembic' || recipe.machineId === 'advanced_alembic').map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b));
  const alchemyAffectedRecipeIds = [...new Set([...extractorRecipeIds, ...distillerRecipeIds])].sort((a, b) => a.localeCompare(b));
  const producedItemIds = new Set(RECIPES.flatMap((recipe) => recipe.outputs.map((output) => output.itemId)));
  const sellableItemIds = ITEMS.filter((item) => item.sellPriceCopper !== undefined && !item.internal).map((item) => item.id).sort((a, b) => a.localeCompare(b));
  const buyableItemIds = ITEMS.filter((item) => item.buyPriceCopper !== undefined && !item.internal).map((item) => item.id).sort((a, b) => a.localeCompare(b));
  const producedItemIdsWithoutSellPrice = [...producedItemIds]
    .filter((itemId) => !itemById[itemId]?.internal && itemById[itemId]?.sellPriceCopper === undefined)
    .sort((a, b) => a.localeCompare(b));
  const buyableAndCraftableItemIds = buyableItemIds.filter((itemId) => getRecipesProducing(itemId).length > 0).sort((a, b) => a.localeCompare(b));
  const internalItemsWithPrice = ITEMS
    .filter((item) => item.internal && (item.sellPriceCopper !== undefined || item.buyPriceCopper !== undefined))
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b));
  const negativePriceItemIds = ITEMS
    .filter((item) => (item.sellPriceCopper !== undefined && item.sellPriceCopper < 0) || (item.buyPriceCopper !== undefined && item.buyPriceCopper < 0))
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b));
  const producerIndexChecks = ['iron_ingot', 'crude_shard', 'steel_ingot', 'lapis_lazuli', 'brine', 'sol']
    .map((itemId) => ({ itemId, producerRecipeIds: getRecipesProducing(itemId).map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b)) }));

  return {
    counts: {
      items: ITEMS.length,
      machines: MACHINES.length,
      recipes: RECIPES.length,
      sellableItems: sellableItemIds.length,
      buyableItems: buyableItemIds.length,
      probabilityRecipes: probabilityRecipeIds.length,
      sameItemInputOutputRecipes: sameItemInputOutputRecipeIds.length,
      extractorRecipes: extractorRecipeIds.length,
      distillerRecipes: distillerRecipeIds.length,
      alchemyAffectedRecipes: alchemyAffectedRecipeIds.length,
      unknownItemRefs: unknownItemRefs.length,
      unknownMachineRefs: unknownMachineRefs.length,
      invalidProbabilityRefs: invalidProbabilityRefs.length,
      invalidAmountRefs: invalidAmountRefs.length,
      duplicateItemIds: duplicateIds(ITEMS.map((item) => item.id)).length,
      duplicateMachineIds: duplicateIds(MACHINES.map((machine) => machine.id)).length,
      duplicateRecipeIds: duplicateIds(RECIPES.map((recipe) => recipe.id)).length,
      machinePortViolations: machinePortViolations.length,
    },
    probabilityRecipeIds,
    sameItemInputOutputRecipeIds,
    extractorRecipeIds,
    distillerRecipeIds,
    alchemyAffectedRecipeIds,
    unknownItemRefs,
    unknownMachineRefs,
    invalidProbabilityRefs,
    invalidAmountRefs,
    duplicateItemIds: duplicateIds(ITEMS.map((item) => item.id)),
    duplicateMachineIds: duplicateIds(MACHINES.map((machine) => machine.id)),
    duplicateRecipeIds: duplicateIds(RECIPES.map((recipe) => recipe.id)),
    sameItemInputOutput,
    probabilityRecipes,
    netNonPositiveOutputRecipes,
    producerIndexChecks,
    priceCoverage: { sellableItemIds, buyableItemIds, producedItemIdsWithoutSellPrice, buyableAndCraftableItemIds, internalItemsWithPrice, negativePriceItemIds },
    machinePortViolations,
  };
}
