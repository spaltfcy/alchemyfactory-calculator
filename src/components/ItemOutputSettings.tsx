import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { Lang, ProductionTarget, TargetDefaults } from '../types';
import { negativeOutputTemporaryError, type UserMessageInput, type UserMessageLog } from '../utils/userMessages';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { getItemSortNameJa, validateItemSortNames } from '../data/itemSortNames';
import { t, text } from '../i18n';

export type ItemOutputSettingsProps = {
  lang: Lang;
  targets: ProductionTarget[];
  targetDefaults: TargetDefaults;
  onChange: (targets: ProductionTarget[]) => void;
  onFocusGraphNode?: (nodeId: string) => void;
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
};

type BulkModeValue = '' | ProductionTarget['mode'];

validateItemSortNames(ITEMS);

function sortItemIdsByDisplayName(itemIds: string[], lang: Lang): string[] {
  const collator = new Intl.Collator(lang === 'ja' ? 'ja' : 'en', {
    numeric: true,
    sensitivity: 'base',
  });

  return [...itemIds].sort((a, b) => {
    const itemA = itemById[a];
    const itemB = itemById[b];
    if (lang === 'ja') {
      const kanaCompare = collator.compare(getItemSortNameJa(a), getItemSortNameJa(b));
      if (kanaCompare !== 0) return kanaCompare;
    }
    return collator.compare(text(itemA.name, lang), text(itemB.name, lang));
  });
}

function getSelectableOutputItems(lang: Lang): string[] {
  const seen = new Set<string>();
  for (const recipe of Object.values(recipeById)) {
    for (const output of recipe.outputs) {
      const item = itemById[output.itemId];
      if (!item || item.internal) continue;
      if (getRecipesProducing(output.itemId).length <= 0) continue;
      seen.add(output.itemId);
    }
  }
  return sortItemIdsByDisplayName([...seen], lang);
}

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getRecipesProducing(itemId)[0]?.id ?? '';
}

function makeTarget(lang: Lang, targetDefaults: TargetDefaults): ProductionTarget {
  const selectable = getSelectableOutputItems(lang);
  const outputItemId = selectable[0] ?? ITEMS[0]?.id ?? '';
  return {
    id: 'target-' + crypto.randomUUID(),
    enabled: true,
    recipeId: getDefaultRecipeId(outputItemId),
    outputItemId,
    mode: targetDefaults.mode,
    value: targetDefaults.value,
  };
}

function moveTargetToIndex(targets: ProductionTarget[], fromIndex: number, toIndex: number): ProductionTarget[] {
  if (fromIndex < 0 || fromIndex >= targets.length || toIndex < 0 || toIndex >= targets.length || fromIndex === toIndex) return targets;
  const next = [...targets];
  const [target] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, target);
  return next;
}

function sameTargetOrder(a: ProductionTarget[], b: ProductionTarget[]): boolean {
  return a.length === b.length && a.every((target, index) => target.id === b[index]?.id);
}

function targetRecipeNodeId(target: ProductionTarget): string {
  const recipeId = target.recipeId || getDefaultRecipeId(target.outputItemId);
  return 'recipe:' + recipeId;
}

export function ItemOutputSettings({ lang, targets, targetDefaults, onChange, onFocusGraphNode, onUserMessage }: ItemOutputSettingsProps) {
  const selectableItems = getSelectableOutputItems(lang);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkMode, setBulkMode] = useState<BulkModeValue>('');
  const [draftTargets, setDraftTargets] = useState(targets);
  const [draggingTargetId, setDraggingTargetId] = useState<string | null>(null);
  const syncedTargetsRef = useRef(targets);

  useEffect(() => {
    if (targets === syncedTargetsRef.current) return;
    syncedTargetsRef.current = targets;
    setDraftTargets(targets);
  }, [targets]);

  function commitTargets(nextTargets: ProductionTarget[]) {
    syncedTargetsRef.current = nextTargets;
    setDraftTargets(nextTargets);
    onChange(nextTargets);
  }

  function showNegativeOutputError(): void {
    onUserMessage?.(negativeOutputTemporaryError());
  }

  function parseNonNegativeInputValue(rawValue: string): number | undefined {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return undefined;
    if (value < 0) {
      showNegativeOutputError();
      return undefined;
    }
    return value;
  }

  function updateTarget(id: string, patch: Partial<ProductionTarget>) {
    const nextTargets = draftTargets.map((target) => {
      if (target.id !== id) return target;
      const next = { ...target, ...patch };
      if (patch.outputItemId) next.recipeId = getDefaultRecipeId(patch.outputItemId);
      if (next.enabled === undefined) next.enabled = true;
      return next;
    });
    commitTargets(nextTargets);
  }

  function applyBulkOutput(modeOverride?: BulkModeValue) {
    const trimmed = bulkValue.trim();
    const hasValue = trimmed !== '';
    const nextMode = modeOverride !== undefined ? modeOverride : bulkMode;
    if (!hasValue && nextMode === '') return;

    const value = Number(trimmed);
    if (hasValue && !Number.isFinite(value)) return;
    if (hasValue && value < 0) {
      showNegativeOutputError();
      return;
    }

    const nextTargets = draftTargets.map((target) => ({
      ...target,
      enabled: target.enabled ?? true,
      ...(hasValue ? { value } : {}),
      ...(nextMode !== '' ? { mode: nextMode } : {}),
    }));

    commitTargets(nextTargets);
    if (hasValue) setBulkValue('');
    if (nextMode !== '') setBulkMode('');
  }

  function onBulkKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyBulkOutput();
  }

  function onBulkModeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.target.value as BulkModeValue;
    setBulkMode(nextMode);
    if (nextMode !== '') applyBulkOutput(nextMode);
  }


  function isNumericValueInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement && target.type === 'number' && target.closest('.item-output-value-field') !== null;
  }

  function onDragStart(event: DragEvent<HTMLElement>, targetId: string): void {
    if (isNumericValueInput(event.target)) {
      event.preventDefault();
      setDraggingTargetId(null);
      return;
    }
    setDraggingTargetId(targetId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', targetId);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onDrop(event: DragEvent<HTMLDivElement>, dropTargetId: string): void {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggingTargetId;
    setDraggingTargetId(null);
    if (!sourceId || sourceId === dropTargetId) return;
    const fromIndex = draftTargets.findIndex((target) => target.id === sourceId);
    const toIndex = draftTargets.findIndex((target) => target.id === dropTargetId);
    const nextTargets = moveTargetToIndex(draftTargets, fromIndex, toIndex);
    if (sameTargetOrder(nextTargets, draftTargets)) return;
    commitTargets(nextTargets);
  }

  const itemLabel = lang === 'ja' ? 'アイテム' : 'Item';
  const outputLabel = lang === 'ja' ? '出力' : 'Output';
  const bulkOutputLabel = lang === 'ja' ? '全出力' : 'All output';
  const bulkModeLabel = lang === 'ja' ? '全指定方法' : 'All methods';
  const noBulkModeLabel = lang === 'ja' ? '変更なし' : 'No change';
  const removeLabel = lang === 'ja' ? '削除' : 'Remove';
  const enabledLabel = lang === 'ja' ? 'このレシピを使う' : 'Use this recipe';

  return (
    <section className="item-output-settings panel">
      <div className="item-output-settings-header">
        <h2>{t('itemOutputSettings', lang)}</h2>
        <div className="item-output-toolbar">
          <label className="item-output-bulk-field item-output-bulk-value">
            <span>{bulkOutputLabel}</span>
            <input
              type="number"
              min={0}
              value={bulkValue}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setBulkValue(event.target.value)}
              onKeyDown={onBulkKeyDown}
              onBlur={() => applyBulkOutput()}
              placeholder=""
            />
          </label>
          <label className="item-output-bulk-field item-output-bulk-mode">
            <span>{bulkModeLabel}</span>
            <select value={bulkMode} onChange={onBulkModeChange}>
              <option value="">{noBulkModeLabel}</option>
              <option value="rate">{t('rateShort', lang)}</option>
              <option value="machines">{t('machinesShort', lang)}</option>
            </select>
          </label>
          <button type="button" onClick={() => commitTargets([...draftTargets, makeTarget(lang, targetDefaults)])}>
            {t('addTarget', lang)}
          </button>
        </div>
      </div>

      <div className="item-output-list" aria-label={t('itemOutputSettings', lang)}>
        {draftTargets.map((target) => (
          <div
            className={draggingTargetId === target.id ? 'item-output-card is-dragging' : 'item-output-card'}
            key={target.id}
            onDragEnd={() => setDraggingTargetId(null)}
            onDragOver={onDragOver}
            onDrop={(event) => onDrop(event, target.id)}
            onDoubleClick={() => onFocusGraphNode?.(targetRecipeNodeId(target))}
          >
            <label className="item-output-field item-output-item-field" draggable onDragStart={(event) => onDragStart(event, target.id)} onDoubleClick={(event) => event.stopPropagation()}>
              <span className="item-output-item-heading">
                <span className="item-output-enabled-checkbox" aria-label={enabledLabel} onDoubleClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={target.enabled ?? true}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateTarget(target.id, { enabled: event.target.checked })}
                  />
                </span>
                <span>{itemLabel}</span>
              </span>
              <select
                value={target.outputItemId}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateTarget(target.id, { outputItemId: event.target.value })
                }
              >
                {selectableItems.map((itemId) => (
                  <option key={itemId} value={itemId}>
                    {text(itemById[itemId].name, lang)}
                  </option>
                ))}
              </select>
            </label>

            <label className="item-output-field item-output-value-field" draggable onDragStart={(event) => onDragStart(event, target.id)} onDoubleClick={(event) => event.stopPropagation()}>
              <span>{outputLabel}</span>
              <input
                type="number"
                min={0}
                draggable={false}
                value={target.value}
                onMouseDown={(event) => event.stopPropagation()}
                onDragStart={(event) => event.preventDefault()}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const value = parseNonNegativeInputValue(event.target.value);
                  if (value === undefined) return;
                  updateTarget(target.id, { value });
                }}
              />
            </label>

            <div className="item-output-field item-output-mode-field" draggable onDragStart={(event) => onDragStart(event, target.id)} onDoubleClick={(event) => event.stopPropagation()}>
              <div className="item-output-mode-heading">
                <span>{t('mode', lang)}</span>
                <button
                  type="button"
                  className="item-output-remove danger"
                  aria-label={removeLabel}
                  onClick={() => commitTargets(draftTargets.filter((x) => x.id !== target.id))}
                >
                  ×
                </button>
              </div>
              <select
                value={target.mode}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateTarget(target.id, { mode: event.target.value as ProductionTarget['mode'] })
                }
              >
                <option value="rate">{t('rateShort', lang)}</option>
                <option value="machines">{t('machinesShort', lang)}</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
