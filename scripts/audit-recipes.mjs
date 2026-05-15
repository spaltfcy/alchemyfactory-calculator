import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function parseObjectBlocksFromArray(source, arrayName) {
  const arrayStart = source.indexOf(arrayName);
  if (arrayStart < 0) return [];
  const start = source.indexOf('= [', arrayStart);
  if (start < 0) return [];
  const blocks = [];
  let cursor = start + 3;
  while (cursor < source.length) {
    while (cursor < source.length && source[cursor] !== '{' && source[cursor] !== ']') cursor += 1;
    if (source[cursor] === ']' || cursor >= source.length) break;
    const objectStart = cursor;
    let depth = 0;
    let quote = '';
    let escape = false;
    let end = -1;
    for (let i = objectStart; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === quote) quote = '';
      } else if (ch === '\'' || ch === '"') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    const block = source.slice(objectStart, end);
    const idMatch = /\bid:\s*'([^']+)'/.exec(block);
    if (idMatch) blocks.push({ id: idMatch[1], block });
    cursor = end;
  }
  return blocks;
}

function parseNameJa(block) {
  return /name:\s*\{[\s\S]*?ja:\s*'([^']+)'/.exec(block)?.[1] ?? '';
}

function extractArraySection(sectionName, block) {
  const label = sectionName + ':';
  const labelIndex = block.indexOf(label);
  if (labelIndex < 0) return '';
  const start = block.indexOf('[', labelIndex);
  if (start < 0) return '';
  let depth = 0;
  let quote = '';
  let escape = false;
  for (let i = start; i < block.length; i += 1) {
    const ch = block[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) quote = '';
    } else if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return block.slice(start + 1, i);
    }
  }
  return '';
}

function parseIO(sectionName, block) {
  const section = extractArraySection(sectionName, block);
  const entries = [];
  const objectRegex = /\{([\s\S]*?)\}/g;
  for (const match of section.matchAll(objectRegex)) {
    const raw = match[1];
    if (/kind:\s*'paradoxableItem'/.test(raw)) {
      const amount = Number(/amount:\s*([0-9.eE+-]+)/.exec(raw)?.[1] ?? 0);
      entries.push({ kind: 'paradoxableItem', amount });
      continue;
    }
    const itemId = /itemId:\s*'([^']+)'/.exec(raw)?.[1];
    if (!itemId) continue;
    const amount = Number(/amount:\s*([0-9.eE+-]+)/.exec(raw)?.[1] ?? 0);
    const probabilityMatch = /probability:\s*([0-9.eE+-]+)/.exec(raw);
    const probability = probabilityMatch ? Number(probabilityMatch[1]) : undefined;
    entries.push({ itemId, amount, probability });
  }
  return entries;
}

const itemsSource = read('src/data/items.ts');
const machinesSource = read('src/data/machines.ts');
const recipesSource = read('src/data/recipes.ts');
const itemBlocks = parseObjectBlocksFromArray(itemsSource, 'export const ITEMS');
const machineBlocks = parseObjectBlocksFromArray(machinesSource, 'export const MACHINES');
const recipeBlocks = parseObjectBlocksFromArray(recipesSource, 'export const RECIPES');
const itemIds = new Set(itemBlocks.map((entry) => entry.id));
const machineIds = new Set(machineBlocks.map((entry) => entry.id));
const itemInfo = Object.fromEntries(itemBlocks.map((entry) => [entry.id, {
  nameJa: parseNameJa(entry.block),
  internal: /internal:\s*true/.test(entry.block),
  sellable: /sellPriceCopper:\s*[0-9]/.test(entry.block),
  buyable: /buyPriceCopper:\s*[0-9]/.test(entry.block),
  physicalState: /physicalState:\s*'liquid'/.test(entry.block) ? 'liquid' : 'solid',
}]));
const recipes = recipeBlocks.map((entry) => ({
  id: entry.id,
  nameJa: parseNameJa(entry.block),
  machineId: /machineId:\s*'([^']+)'/.exec(entry.block)?.[1] ?? '',
  timeSec: Number(/timeSec:\s*([0-9.eE+-]+)/.exec(entry.block)?.[1] ?? 0),
  internal: /internal:\s*true/.test(entry.block),
  inputs: parseIO('inputs', entry.block),
  outputs: parseIO('outputs', entry.block),
}));
function inputAmount(recipe, itemId) {
  return recipe.inputs.reduce((sum, input) => sum + (input.itemId === itemId ? input.amount : 0), 0);
}
function outputExpected(recipe, itemId) {
  return recipe.outputs.reduce((sum, output) => sum + (output.itemId === itemId ? output.amount * (output.probability ?? 1) : 0), 0);
}
function net(recipe, itemId) {
  return outputExpected(recipe, itemId) - inputAmount(recipe, itemId);
}
const probabilityRecipes = recipes.filter((recipe) => recipe.outputs.some((output) => output.probability !== undefined));
const sameItemInputOutput = [];
const netNonPositiveOutputRecipes = [];
const producerIndex = {};
for (const recipe of recipes) {
  const ids = uniqueSorted([...recipe.inputs.map((input) => input.itemId).filter(Boolean), ...recipe.outputs.map((output) => output.itemId)]);
  const inputIds = new Set(recipe.inputs.map((input) => input.itemId).filter(Boolean));
  const outputIds = new Set(recipe.outputs.map((output) => output.itemId));
  for (const itemId of ids) {
    const n = net(recipe, itemId);
    if (inputIds.has(itemId) && outputIds.has(itemId)) sameItemInputOutput.push({ recipeId: recipe.id, itemId, inputPerRun: inputAmount(recipe, itemId), expectedOutputPerRun: outputExpected(recipe, itemId), netPerRun: n, producer: n > 1e-9 });
    if (outputIds.has(itemId) && n <= 1e-9) netNonPositiveOutputRecipes.push({ recipeId: recipe.id, itemId, netPerRun: n });
    if (n > 1e-9) (producerIndex[itemId] ??= []).push(recipe.id);
  }
}
for (const producers of Object.values(producerIndex)) producers.sort((a, b) => a.localeCompare(b));
const unknownItemRefs = [];
const invalidProbabilityRefs = [];
const invalidAmountRefs = [];
const unknownMachineRefs = [];
for (const recipe of recipes) {
  if (!machineIds.has(recipe.machineId)) unknownMachineRefs.push({ recipeId: recipe.id, machineId: recipe.machineId });
  if (recipe.id !== 'oblivion_essence' && (!Number.isFinite(recipe.timeSec) || recipe.timeSec <= 0)) invalidAmountRefs.push({ ownerId: recipe.id, field: 'timeSec', amount: recipe.timeSec });
  if (recipe.outputs.length === 0) invalidAmountRefs.push({ ownerId: recipe.id, field: 'outputs.length', amount: 0 });
  for (const input of recipe.inputs) {
    if (!input.itemId) continue;
    if (!itemIds.has(input.itemId)) unknownItemRefs.push({ recipeId: recipe.id, direction: 'input', itemId: input.itemId });
    if (!Number.isFinite(input.amount) || input.amount <= 0) invalidAmountRefs.push({ ownerId: recipe.id, field: `input.${input.itemId}`, amount: input.amount });
  }
  for (const output of recipe.outputs) {
    if (!itemIds.has(output.itemId)) unknownItemRefs.push({ recipeId: recipe.id, direction: 'output', itemId: output.itemId });
    if (!Number.isFinite(output.amount) || output.amount <= 0) invalidAmountRefs.push({ ownerId: recipe.id, field: `output.${output.itemId}`, amount: output.amount });
    const p = output.probability ?? 1;
    if (!Number.isFinite(p) || p <= 0 || p > 1) invalidProbabilityRefs.push({ recipeId: recipe.id, itemId: output.itemId, probability: p });
  }
}
const extractorRecipeIds = recipes.filter((recipe) => recipe.machineId === 'extractor').map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b));
const distillerRecipeIds = recipes.filter((recipe) => recipe.machineId === 'alembic' || recipe.machineId === 'advanced_alembic').map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b));
const alchemyAffectedRecipeIds = uniqueSorted([...extractorRecipeIds, ...distillerRecipeIds]);
const report = {
  counts: {
    items: itemBlocks.length,
    machines: machineBlocks.length,
    recipes: recipes.length,
    sellableItems: Object.values(itemInfo).filter((item) => item.sellable && !item.internal).length,
    buyableItems: Object.values(itemInfo).filter((item) => item.buyable && !item.internal).length,
    probabilityRecipes: probabilityRecipes.length,
    sameItemInputOutputRecipes: uniqueSorted(sameItemInputOutput.map((entry) => entry.recipeId)).length,
    extractorRecipes: extractorRecipeIds.length,
    distillerRecipes: distillerRecipeIds.length,
    alchemyAffectedRecipes: alchemyAffectedRecipeIds.length,
    unknownItemRefs: unknownItemRefs.length,
    unknownMachineRefs: unknownMachineRefs.length,
    invalidProbabilityRefs: invalidProbabilityRefs.length,
    invalidAmountRefs: invalidAmountRefs.length,
  },
  probabilityRecipeIds: probabilityRecipes.map((recipe) => recipe.id).sort((a, b) => a.localeCompare(b)),
  sameItemInputOutputRecipeIds: uniqueSorted(sameItemInputOutput.map((entry) => entry.recipeId)),
  extractorRecipeIds,
  distillerRecipeIds,
  alchemyAffectedRecipeIds,
  sameItemInputOutput,
  netNonPositiveOutputRecipes,
  producerIndexChecks: ['iron_ingot', 'crude_shard', 'steel_ingot', 'lapis_lazuli', 'brine', 'sol'].map((itemId) => ({ itemId, producerRecipeIds: producerIndex[itemId] ?? [] })),
  unknownItemRefs,
  unknownMachineRefs,
  invalidProbabilityRefs,
  invalidAmountRefs,
};
mkdirSync(new URL('../tmp', import.meta.url), { recursive: true });
writeFileSync(new URL('../tmp/recipe-data-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log('[audit-recipes] wrote tmp/recipe-data-audit.json');
console.log('[audit-recipes] ' + JSON.stringify(report.counts));
