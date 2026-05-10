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

const itemsSource = read('src/data/items.ts');
const machinesSource = read('src/data/machines.ts');
const recipesSource = read('src/data/recipes.ts');

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

console.log('[validate-data] ok');
