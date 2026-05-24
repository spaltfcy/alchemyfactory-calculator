import type { Lang, ProductionTarget, TargetDefaults } from '../types';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { t } from '../i18n';
import type { UserMessageInput, UserMessageLog } from '../utils/userMessages';
import { OutputTargetSettings, sortItemIdsByDisplayName } from './OutputTargetSettings';

export type ItemOutputSettingsProps = {
  lang: Lang;
  targets: ProductionTarget[];
  targetDefaults: TargetDefaults;
  onChange: (targets: ProductionTarget[]) => void;
  onFocusGraphNode?: (nodeId: string) => void;
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
};

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

function normalizeItemTargetPatch(target: ProductionTarget, patch: Partial<ProductionTarget>): ProductionTarget {
  const next = { ...target, ...patch };
  if (patch.outputItemId) next.recipeId = getDefaultRecipeId(patch.outputItemId);
  if (next.enabled === undefined) next.enabled = true;
  return next;
}

function targetRecipeNodeId(target: ProductionTarget): string | undefined {
  const recipeId = target.recipeId || getDefaultRecipeId(target.outputItemId);
  return recipeId ? 'recipe:' + recipeId : undefined;
}

export function ItemOutputSettings({ lang, targets, targetDefaults, onChange, onFocusGraphNode, onUserMessage }: ItemOutputSettingsProps) {
  return (
    <OutputTargetSettings
      lang={lang}
      targets={targets}
      title={t('itemOutputSettings', lang)}
      listAriaLabel={t('itemOutputSettings', lang)}
      enabledLabel={lang === 'ja' ? 'このレシピを使う' : 'Use this recipe'}
      selectableItemIds={getSelectableOutputItems(lang)}
      makeTarget={() => makeTarget(lang, targetDefaults)}
      normalizeTargetPatch={normalizeItemTargetPatch}
      getFocusNodeId={targetRecipeNodeId}
      onChange={onChange}
      onFocusGraphNode={onFocusGraphNode}
      onUserMessage={onUserMessage}
    />
  );
}
