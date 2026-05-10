import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

function unique(values) {
  return [...new Set(values)];
}

function fail(message, details) {
  console.error('[validate-data] ' + message);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
}

function parseIds(source) {
  return [...source.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
}

function parseMachineBlocks(source) {
  const blocks = [];
  let cursor = 0;
  while (true) {
    const idMatch = /\bid:\s*'([^']+)'/.exec(source.slice(cursor));
    if (!idMatch) break;
    const idStart = cursor + idMatch.index;
    const objectStart = source.lastIndexOf('{', idStart);
    if (objectStart < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = objectStart; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
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
    blocks.push({ id: idMatch[1], block });
    cursor = end;
  }
  return blocks;
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

const itemsSource = read('src/data/items.ts');
const machinesSource = read('src/data/machines.ts');
const recipesSource = read('src/data/recipes.ts');
const defaultStateSource = read('src/defaultState.ts');
const paradoxSource = read('src/data/paradox.ts');
const abilityTablesSource = read('src/data/abilityTables.ts');

const itemIds = new Set(parseIds(itemsSource));
const machineBlocks = parseMachineBlocks(machinesSource);
const machineIds = new Set(machineBlocks.map((machine) => machine.id));

const duplicatedMachineIds = Object.entries(
  machineBlocks.reduce((map, machine) => {
    map[machine.id] = (map[machine.id] ?? 0) + 1;
    return map;
  }, {}),
).filter(([, count]) => count > 1);
if (duplicatedMachineIds.length > 0) fail('duplicate machine ids', duplicatedMachineIds);

const namesByJa = {};
for (const machine of machineBlocks) {
  const jaMatch = /name:\s*\{[\s\S]*?ja:\s*'([^']+)'/.exec(machine.block);
  if (!jaMatch) fail('machine is missing Japanese name', machine.id);
  const name = jaMatch[1].trim();
  if (!name) fail('machine has an empty Japanese name', machine.id);
  (namesByJa[name] ??= []).push(machine.id);
}
const duplicatedJaNames = Object.entries(namesByJa).filter(([, ids]) => ids.length > 1);
if (duplicatedJaNames.length > 0) fail('duplicate machine Japanese names', duplicatedJaNames);

const unknownBuildCostItems = [];
for (const machine of machineBlocks) {
  for (const match of machine.block.matchAll(/itemId:\s*'([^']+)'/g)) {
    if (!itemIds.has(match[1])) unknownBuildCostItems.push({ machineId: machine.id, itemId: match[1] });
  }
}
if (unknownBuildCostItems.length > 0) fail('unknown buildCost item ids', unknownBuildCostItems);

const unknownRecipeMachines = unique([...recipesSource.matchAll(/machineId:\s*'([^']+)'/g)].map((match) => match[1]))
  .filter((machineId) => !machineIds.has(machineId));
if (unknownRecipeMachines.length > 0) fail('unknown recipe machine ids', unknownRecipeMachines);

const itemBlocks = parseObjectBlocksFromArray(itemsSource, 'export const ITEMS');
const recipeBlocks = parseObjectBlocksFromArray(recipesSource, 'export const RECIPES');
const paradoxableItemIds = [];
for (const item of itemBlocks) {
  const paradoxMatch = /paradoxTimeSec:\s*([0-9.eE+-]+)/.exec(item.block);
  if (!paradoxMatch) continue;
  const value = Number(paradoxMatch[1]);
  if (!Number.isFinite(value) || value <= 0) fail('invalid paradoxTimeSec', { itemId: item.id, value: paradoxMatch[1] });
  paradoxableItemIds.push(item.id);
}
if (paradoxableItemIds.length <= 0) fail('no paradoxable items found');

for (const recipe of recipeBlocks) {
  const hasParadoxable = /kind:\s*'paradoxableItem'/.test(recipe.block);
  if (hasParadoxable && recipe.id !== 'oblivion_essence') fail('paradoxableItem input is only allowed on oblivion_essence', recipe.id);
  if (recipe.id === 'oblivion_essence') {
    if (!hasParadoxable) fail('oblivion_essence must have a paradoxableItem input');
    const amountMatch = /kind:\s*'paradoxableItem'[\s\S]*?amount:\s*([0-9.]+)/.exec(recipe.block);
    if (!amountMatch || Number(amountMatch[1]) !== 1) fail('oblivion_essence paradoxableItem amount must be 1', recipe.block);
  }
  if (recipe.id === 'vitality_essence' && hasParadoxable) fail('vitality_essence must not have a paradoxableItem input');
}

const defaultParadoxMatch = /oblivionInputItemId:\s*'([^']+)'/.exec(paradoxSource);
if (!defaultParadoxMatch) fail('missing default paradox oblivionInputItemId');
if (!paradoxableItemIds.includes(defaultParadoxMatch[1])) fail('default paradox item is not paradoxable', defaultParadoxMatch[1]);

for (const match of abilityTablesSource.matchAll(/\w+Add:\s*\[([^\]]*)\]/g)) {
  const values = match[1].split(',').map((value) => value.trim()).filter(Boolean).map(Number);
  if (values.length <= 0 || values.some((value) => !Number.isFinite(value))) fail('invalid ability table values', match[0]);
  if (!Number.isFinite(values[values.length - 1])) fail('invalid ability table final value', match[0]);
}

console.log('[validate-data] ok');
