import type { Lang, ProductionTarget, TargetDefaults } from '../types';
import { ITEMS } from '../data/items';
import type { UserMessageInput, UserMessageLog } from '../utils/userMessages';
import { OutputTargetSettings, sortItemIdsByDisplayName } from './OutputTargetSettings';

export type CauldronOutputSettingsProps = {
  lang: Lang;
  targets: ProductionTarget[];
  targetDefaults: TargetDefaults;
  onChange: (targets: ProductionTarget[]) => void;
  onFocusGraphNode?: (nodeId: string) => void;
  getFocusGraphNodeId?: (target: ProductionTarget) => string | undefined;
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
};

function getSelectableCauldronOutputItems(lang: Lang): string[] {
  return sortItemIdsByDisplayName(ITEMS.filter((item) => !item.internal).map((item) => item.id), lang);
}

function makeTarget(lang: Lang, targetDefaults: TargetDefaults): ProductionTarget {
  const selectable = getSelectableCauldronOutputItems(lang);
  const outputItemId = selectable[0] ?? ITEMS[0]?.id ?? '';
  return {
    id: 'cauldron-target-' + crypto.randomUUID(),
    enabled: true,
    recipeId: '',
    outputItemId,
    mode: 'rate',
    value: targetDefaults.value > 0 ? targetDefaults.value : 1,
  };
}

function normalizeCauldronTarget(target: ProductionTarget, patch: Partial<ProductionTarget> = {}): ProductionTarget {
  const rawValue = Number(patch.value ?? target.value);
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 1;
  return { ...target, ...patch, enabled: true, recipeId: '', mode: 'rate', value };
}

function normalizeCauldronTargetPatch(target: ProductionTarget, patch: Partial<ProductionTarget>): ProductionTarget {
  return normalizeCauldronTarget(target, patch);
}

export function CauldronOutputSettings({
  lang,
  targets,
  targetDefaults,
  onChange,
  onFocusGraphNode,
  getFocusGraphNodeId,
  onUserMessage,
}: CauldronOutputSettingsProps) {
  return (
    <OutputTargetSettings
      lang={lang}
      targets={targets}
      title={lang === 'ja' ? '錬金釜ターゲット' : 'Cauldron target'}
      listAriaLabel={lang === 'ja' ? '錬金釜ターゲット' : 'Cauldron target'}
      enabledLabel={lang === 'ja' ? 'このターゲットを使う' : 'Use this target'}
      sectionClassName="cauldron-output-settings"
      selectableItemIds={getSelectableCauldronOutputItems(lang)}
      makeTarget={() => makeTarget(lang, targetDefaults)}
      normalizeTargetPatch={normalizeCauldronTargetPatch}
      getFocusNodeId={getFocusGraphNodeId}
      onChange={onChange}
      onFocusGraphNode={onFocusGraphNode}
      onUserMessage={onUserMessage}
    />
  );
}
