import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { AppState, Lang, Recipe, RecipeInput } from '../types';
import { ITEMS, itemById } from '../data/items';
import { machineById } from '../data/machines';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, RECIPE_ORDER } from '../data/recipes';
import { getEffectiveRecipeForCalculation, isItemRecipeInput } from '../data/effectiveRecipes';
import { getParadoxSettings } from '../data/paradox';
import { text } from '../i18n';

export type RecipeSettingsTabProps = {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
};

const RECIPE_SETTINGS_ITEM_ORDER = [
  'plank',
  'stone',
  'charcoal',
  'coal',
  'coke',
  'sand',
  'salt',
  'iron_sand',
  'copper_ingot',
  'copper_powder',
  'iron_ingot',
  'silver_ingot',
  'silver_powder',
  'gold_ingot',
  'gold_dust',
  'impure_gold_dust',
  'pure_gold_dust',
  'volcanic_ash',
  'crude_shard',
  'shattered_crystal',
  'ruby',
  'sapphire',
  'emerald',
  'adamant',
  'obsidian',
  'steam',
];

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getSortedRecipesProducing(itemId)[0]?.id ?? '';
}

function recipeOrder(recipe: Recipe): number {
  return RECIPE_ORDER[recipe.id] ?? 999999;
}

function getSortedRecipesProducing(itemId: string): Recipe[] {
  return [...getRecipesProducing(itemId)].sort((a, b) => recipeOrder(a) - recipeOrder(b) || a.id.localeCompare(b.id));
}

function recipeItemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function joinRecipeItemNames(entries: Array<{ itemId: string }>, lang: Lang): string {
  const separator = lang === 'ja' ? '・' : ', ';
  return entries.map((entry) => recipeItemName(entry.itemId, lang)).join(separator);
}

function recipeInputItemName(input: RecipeInput, lang: Lang, state: AppState): string {
  if (isItemRecipeInput(input)) return recipeItemName(input.itemId, lang);
  return recipeItemName(getParadoxSettings(state.settings).oblivionInputItemId, lang);
}

function joinRecipeInputNames(entries: RecipeInput[], lang: Lang, state: AppState): string {
  const separator = lang === 'ja' ? '・' : ', ';
  return entries.map((entry) => recipeInputItemName(entry, lang, state)).join(separator);
}

function isMeteorCrusherRecipe(recipe: Recipe): boolean {
  const idText = recipe.id.toLowerCase();
  const hasMeteorInput = recipe.inputs.some((input) => isItemRecipeInput(input) && input.itemId.includes('meteor'));
  const hasManyStoneCrusherOutputs = recipe.machineId === 'stone_crusher' && recipe.outputs.length >= 3;
  return hasMeteorInput || idText.includes('meteor') || hasManyStoneCrusherOutputs;
}

function recipeOutputNames(recipe: Recipe, lang: Lang): string {
  if (isMeteorCrusherRecipe(recipe) && recipe.outputs.length >= 1) {
    return recipeItemName(recipe.outputs[0].itemId, lang) + ' etc.';
  }
  return recipe.outputs.length ? joinRecipeItemNames(recipe.outputs, lang) : text(recipe.name, lang);
}

function formatCompactRecipeNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(1).replace(/\.0$/, '');
  if (Math.abs(value) >= 10) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function recipeOptionDetail(recipe: Recipe, lang: Lang): string {
  if (recipe.machineId !== 'steam_boiler') return '';
  const steamOutput = recipe.outputs.find((output) => output.itemId === 'steam');
  const steamPerMinute = steamOutput && recipe.timeSec > 0 ? (steamOutput.amount * 60) / recipe.timeSec : 0;
  const heatPerSec = recipe.heatInputPerSec ?? 0;
  if (steamPerMinute <= 0 && heatPerSec <= 0) return '';
  return lang === 'ja'
    ? `（蒸気 ${formatCompactRecipeNumber(steamPerMinute)}/min・熱 ${formatCompactRecipeNumber(heatPerSec)}P/s）`
    : ` (steam ${formatCompactRecipeNumber(steamPerMinute)}/min, heat ${formatCompactRecipeNumber(heatPerSec)}P/s)`;
}

function recipeOptionLabel(recipe: Recipe, lang: Lang, state: AppState): string {
  const effectiveRecipe = getEffectiveRecipeForCalculation(recipe, state.settings);
  const machine = machineById[effectiveRecipe.machineId] ?? machineById[recipe.machineId];
  const inputNames = recipe.inputs.length ? joinRecipeInputNames(recipe.inputs, lang, state) : text(recipe.name, lang);
  const machineName = machine ? text(machine.name, lang) : effectiveRecipe.machineId;
  const outputNames = recipeOutputNames(recipe, lang);
  const detail = recipeOptionDetail(recipe, lang);
  return `${inputNames} → ${machineName} → ${outputNames}${detail}`;
}

function buildRecipeSettingsItems(lang: Lang): typeof ITEMS {
  const multiRecipeItems = ITEMS.filter((item) => getRecipesProducing(item.id).length > 1);
  const multiRecipeItemsById = new Map(multiRecipeItems.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const orderedIds: string[] = [];

  function append(itemId: string): void {
    if (seen.has(itemId)) return;
    const item = multiRecipeItemsById.get(itemId);
    if (!item) return;
    seen.add(itemId);
    orderedIds.push(itemId);
  }

  for (const itemId of RECIPE_SETTINGS_ITEM_ORDER) {
    if (itemId !== 'steam') append(itemId);
  }

  for (const item of multiRecipeItems) {
    if (item.id !== 'steam') append(item.id);
  }

  append('steam');

  return orderedIds
    .map((itemId) => multiRecipeItemsById.get(itemId))
    .filter((item): item is (typeof ITEMS)[number] => Boolean(item));
}

export function RecipeSettingsTab({ state, setState }: RecipeSettingsTabProps) {
  const lang = state.language;
  const recipeItems = buildRecipeSettingsItems(lang);

  return (
    <div className="recipe-settings-tab">
      <section className="panel settings-panel recipe-settings-panel recipe-settings-panel-full">
        <h2>{lang === 'ja' ? 'レシピ設定' : 'Recipe settings'}</h2>

        <div className="settings-panel-body">
          <div className="recipe-settings-list recipe-settings-list-two-column">
            {recipeItems.map((item) => {
              const recipes = getSortedRecipesProducing(item.id);
              const value = state.recipePreferences[item.id] ?? getDefaultRecipeId(item.id);

              return (
                <label key={item.id} className="recipe-setting-row">
                  <span className="recipe-setting-item-name">{text(item.name, lang)}</span>
                  <select
                    id={`recipe-preference-${item.id}`}
                    name={`recipe-preference-${item.id}`}
                    value={value}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                      setState((current) => ({
                        ...current,
                        recipePreferences: {
                          ...current.recipePreferences,
                          [item.id]: event.target.value,
                        },
                      }));
                    }}
                  >
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipeOptionLabel(recipe, lang, state)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
