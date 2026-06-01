import type { ChangeEvent, KeyboardEvent } from 'react';
import type { ExternalSourceMode, Lang, ProductionTarget, TargetDefaults } from '../types';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { CAULDRON_TARGETS } from '../cauldron/cauldronData';
import { negativeOutputTemporaryError, type UserMessageInput, type UserMessageLog } from '../utils/userMessages';
import { t, text } from '../i18n';
import { sortItemIdsByDisplayName } from './OutputTargetSettings';

export type CauldronOutputSettingsProps = {
  lang: Lang;
  targets: ProductionTarget[];
  targetDefaults: TargetDefaults;
  fuelSourceMode: ExternalSourceMode;
  fertilizerSourceMode: ExternalSourceMode;
  showFuelLines: boolean;
  showFertilizerLines: boolean;
  roundGraphNumbersToInteger: boolean;
  onChange: (targets: ProductionTarget[]) => void;
  onChangeSupportModes: (patch: { fuelSourceMode?: ExternalSourceMode; fertilizerSourceMode?: ExternalSourceMode }) => void;
  onChangeGraphOptions: (patch: { showFuelLines?: boolean; showFertilizerLines?: boolean; roundGraphNumbersToInteger?: boolean }) => void;
  onFocusGraphNode?: (nodeId: string) => void;
  getFocusGraphNodeId?: (target: ProductionTarget) => string | undefined;
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
};

const NURSERY_MACHINE_IDS = new Set(['nursery', 'world_tree_nursery']);

function hasCauldronTarget(itemId: string): boolean {
  return CAULDRON_TARGETS[itemId] !== undefined;
}

function hasNonNurseryRecipe(itemId: string): boolean {
  return getRecipesProducing(itemId).some((recipe) => !NURSERY_MACHINE_IDS.has(recipe.machineId));
}

function isNurseryOnlyOutput(itemId: string): boolean {
  const recipes = getRecipesProducing(itemId);
  return recipes.length > 0 && recipes.every((recipe) => NURSERY_MACHINE_IDS.has(recipe.machineId));
}

function isPurchaseOnly(itemId: string): boolean {
  const item = itemById[itemId];
  return item?.buyPriceCopper !== undefined && !hasCauldronTarget(itemId) && !hasNonNurseryRecipe(itemId);
}

function getSelectableCauldronOutputItems(lang: Lang): string[] {
  const selectable = ITEMS
    .filter((item) => !item.internal)
    .filter((item) => item.category !== 'seed')
    .filter((item) => !isNurseryOnlyOutput(item.id))
    .filter((item) => !isPurchaseOnly(item.id))
    .filter((item) => hasCauldronTarget(item.id) || hasNonNurseryRecipe(item.id))
    .map((item) => item.id);
  return sortItemIdsByDisplayName(selectable, lang);
}

function defaultRecipeIdForItem(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? '';
}

function makeTarget(lang: Lang, targetDefaults: TargetDefaults): ProductionTarget {
  const selectable = getSelectableCauldronOutputItems(lang);
  const outputItemId = selectable.includes('coke') ? 'coke' : (selectable[0] ?? ITEMS[0]?.id ?? '');
  const rawValue = Number(targetDefaults.value);
  return {
    id: 'cauldron-target-' + crypto.randomUUID(),
    enabled: true,
    recipeId: defaultRecipeIdForItem(outputItemId),
    outputItemId,
    mode: targetDefaults.mode ?? 'machines',
    value: Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 1,
  };
}

function normalizeCauldronTarget(target: ProductionTarget, patch: Partial<ProductionTarget> = {}): ProductionTarget {
  const outputItemId = patch.outputItemId ?? target.outputItemId;
  const rawValue = Number(patch.value ?? target.value);
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 1;
  const mode = patch.mode ?? target.mode ?? 'machines';
  const itemChanged = patch.outputItemId !== undefined && patch.outputItemId !== target.outputItemId;
  const recipeId = patch.recipeId ?? (itemChanged ? defaultRecipeIdForItem(outputItemId) : target.recipeId ?? defaultRecipeIdForItem(outputItemId));
  return {
    ...target,
    ...patch,
    enabled: true,
    recipeId,
    outputItemId,
    mode,
    value,
  };
}

export function CauldronOutputSettings({
  lang,
  targets,
  targetDefaults,
  fuelSourceMode,
  fertilizerSourceMode,
  showFuelLines,
  showFertilizerLines,
  roundGraphNumbersToInteger,
  onChange,
  onChangeSupportModes,
  onChangeGraphOptions,
  onFocusGraphNode,
  getFocusGraphNodeId,
  onUserMessage,
}: CauldronOutputSettingsProps) {
  const selectableItemIds = getSelectableCauldronOutputItems(lang);
  const baseTarget = targets.find((target) => (target.enabled ?? true) !== false) ?? targets[0] ?? makeTarget(lang, targetDefaults);
  const fallbackOutputItemId = selectableItemIds.includes(baseTarget.outputItemId) ? baseTarget.outputItemId : (selectableItemIds[0] ?? baseTarget.outputItemId);
  const target = normalizeCauldronTarget(baseTarget, { outputItemId: fallbackOutputItemId });

  function commitTarget(patch: Partial<ProductionTarget>): void {
    onChange([normalizeCauldronTarget(target, patch)]);
  }

  function showNegativeOutputError(): void {
    onUserMessage?.(negativeOutputTemporaryError());
  }

  function updateValue(raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (value < 0) {
      showNegativeOutputError();
      return;
    }
    commitTarget({ value });
  }

  function onValueKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.currentTarget.blur();
  }

  function focusTarget(): void {
    const nodeId = getFocusGraphNodeId?.(target);
    if (nodeId) onFocusGraphNode?.(nodeId);
  }

  const itemLabel = lang === 'ja' ? 'アイテム' : 'Item';
  const outputLabel = lang === 'ja' ? '出力' : 'Output';
  const modeLabel = t('mode', lang);
  const fuelLabel = lang === 'ja' ? '燃料' : 'Fuel';
  const fertilizerLabel = lang === 'ja' ? '肥料' : 'Fertilizer';
  const internalLabel = lang === 'ja' ? '内部生産' : 'Internal';
  const externalLabel = lang === 'ja' ? '外部供給' : 'External';
  const graphLineLabel = lang === 'ja' ? 'グラフ表示' : 'Graph lines';
  const showFuelLineLabel = lang === 'ja' ? '燃料線' : 'Fuel lines';
  const showFertilizerLineLabel = lang === 'ja' ? '肥料線' : 'Fertilizer lines';
  const integerRoundLabel = lang === 'ja' ? '整数丸め' : 'Round numbers';

  return (
    <section className="item-output-settings panel cauldron-output-settings">
      <div className="item-output-settings-header">
        <h2>{lang === 'ja' ? '錬金釜ターゲット' : 'Cauldron target'}</h2>
      </div>
      <div className="item-output-list" aria-label={lang === 'ja' ? '錬金釜ターゲット' : 'Cauldron target'}>
        <div className="item-output-card" onDoubleClick={focusTarget}>
          <label className="item-output-field item-output-item-field" onDoubleClick={(event) => event.stopPropagation()}>
            <span className="item-output-item-heading">
              <span>{itemLabel}</span>
            </span>
            <select
              value={target.outputItemId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => commitTarget({ outputItemId: event.target.value })}
            >
              {selectableItemIds.map((itemId) => (
                <option key={itemId} value={itemId}>
                  {text(itemById[itemId].name, lang)}
                </option>
              ))}
            </select>
          </label>

          <label className="item-output-field item-output-value-field" onDoubleClick={(event) => event.stopPropagation()}>
            <span>{outputLabel}</span>
            <input
              type="number"
              min={0}
              value={target.value}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(event.target.value)}
              onKeyDown={onValueKeyDown}
            />
          </label>

          <label className="item-output-field item-output-mode-field" onDoubleClick={(event) => event.stopPropagation()}>
            <span className="item-output-mode-heading">{modeLabel}</span>
            <select value={target.mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => commitTarget({ mode: event.target.value as ProductionTarget['mode'] })}>
              <option value="rate">{t('rateShort', lang)}</option>
              <option value="machines">{t('machinesShort', lang)}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="cauldron-support-source-settings" aria-label={lang === 'ja' ? '燃料・肥料供給' : 'Fuel and fertilizer supply'}>
        <label className="item-output-field cauldron-support-source-field">
          <span>{fuelLabel}</span>
          <select value={fuelSourceMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChangeSupportModes({ fuelSourceMode: event.target.value as ExternalSourceMode })}>
            <option value="internal">{internalLabel}</option>
            <option value="external">{externalLabel}</option>
          </select>
        </label>
        <label className="item-output-field cauldron-support-source-field">
          <span>{fertilizerLabel}</span>
          <select value={fertilizerSourceMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChangeSupportModes({ fertilizerSourceMode: event.target.value as ExternalSourceMode })}>
            <option value="internal">{internalLabel}</option>
            <option value="external">{externalLabel}</option>
          </select>
        </label>
      </div>

      <div className="cauldron-graph-option-settings" aria-label={graphLineLabel}>
        <div className="cauldron-graph-option-heading">{graphLineLabel}</div>
        <label className="cauldron-graph-option-checkbox">
          <input type="checkbox" checked={showFuelLines} onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeGraphOptions({ showFuelLines: event.target.checked })} />
          <span>{showFuelLineLabel}</span>
        </label>
        <label className="cauldron-graph-option-checkbox">
          <input type="checkbox" checked={showFertilizerLines} onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeGraphOptions({ showFertilizerLines: event.target.checked })} />
          <span>{showFertilizerLineLabel}</span>
        </label>
        <label className="cauldron-graph-option-checkbox">
          <input type="checkbox" checked={roundGraphNumbersToInteger} onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeGraphOptions({ roundGraphNumbersToInteger: event.target.checked })} />
          <span>{integerRoundLabel}</span>
        </label>
      </div>
    </section>
  );
}
