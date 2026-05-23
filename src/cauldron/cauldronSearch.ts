import { ITEMS } from '../data/items';
import { getRecipesProducing, RECIPES } from '../data/recipes';
import { text } from '../i18n';
import type { Item, Lang, LocalizedText, Recipe } from '../types';
import { CAULDRON_TARGETS, STATIC_CAULDRON_RECIPES } from './cauldronData';
import { generateCauldronCandidatesForOutput } from './cauldronMath';
import type { CauldronPlanItem, CauldronTargetPlan } from './cauldronTypes';

const itemById: Record<string, Item> = Object.fromEntries(ITEMS.map((item) => [item.id, item]));

function labelForItem(itemId: string): LocalizedText {
  return itemById[itemId]?.name ?? { ja: itemId, en: itemId };
}

export function cauldronItemName(itemId: string, lang: Lang): string {
  return text(labelForItem(itemId), lang);
}

function itemInputIds(recipe: Recipe): { itemId: string; amount: number }[] {
  return recipe.inputs
    .filter((input) => input.kind !== 'paradoxableItem')
    .map((input) => ({ itemId: input.itemId, amount: input.amount }));
}

function chooseNormalRecipe(itemId: string): Recipe | undefined {
  return getRecipesProducing(itemId).find((recipe) => recipe.machineId !== 'cauldron' && recipe.machineId !== 'advanced_cauldron' && !recipe.internal);
}

function chooseHandCauldronRecipe(itemId: string): Recipe | undefined {
  return STATIC_CAULDRON_RECIPES.find((recipe) => recipe.outputs.some((output) => output.itemId === itemId && output.amount > 0));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}

export function parseItemIdsText(raw: string): string[] {
  return unique(raw.split(/[\s,、/]+/).map((part) => part.trim()).filter(Boolean));
}

function analyzeItem(
  itemId: string,
  amount: number,
  startupItemIds: Set<string>,
  depth: number,
  seen: Set<string>,
): CauldronPlanItem {
  const label = labelForItem(itemId);

  if (startupItemIds.has(itemId)) {
    return {
      itemId,
      label,
      amount,
      status: 'startup',
      reason: { ja: '起動入力として指定済み', en: 'Provided as a startup input' },
      children: [],
    };
  }

  if (seen.has(itemId)) {
    return {
      itemId,
      label,
      amount,
      status: 'cycle',
      reason: { ja: '通常レシピ展開中に循環を検出', en: 'Cycle detected while expanding normal recipes' },
      children: [],
    };
  }

  const cauldronTarget = CAULDRON_TARGETS[itemId];
  if (cauldronTarget) {
    const candidateCount = generateCauldronCandidatesForOutput(itemId, { maxCandidates: 9999 }).length;
    return {
      itemId,
      label,
      amount,
      status: 'cauldronTarget',
      reason: {
        ja: `錬金釜ターゲット値あり。候補${candidateCount}件。速度/熱は${cauldronTarget.timeSec === undefined ? '未確認' : '一部あり'}。`,
        en: `Has a cauldron target value. ${candidateCount} candidates. Time/heat is ${cauldronTarget.timeSec === undefined ? 'unverified' : 'partially known'}.`,
      },
      candidateCount,
      children: [],
    };
  }

  if (depth <= 0) {
    return {
      itemId,
      label,
      amount,
      status: 'depthLimit',
      reason: { ja: '展開深度の上限。v0.10.1では暫定表示。', en: 'Depth limit reached. v0.10.1 shows this provisionally.' },
      children: [],
    };
  }

  const normalRecipe = chooseNormalRecipe(itemId);
  if (normalRecipe) {
    const nextSeen = new Set(seen);
    nextSeen.add(itemId);
    const children = itemInputIds(normalRecipe).map((input) => analyzeItem(input.itemId, input.amount * amount, startupItemIds, depth - 1, nextSeen));
    return {
      itemId,
      label,
      amount,
      status: 'normal',
      reason: { ja: `通常レシピ ${normalRecipe.id} で展開`, en: `Expanded through normal recipe ${normalRecipe.id}` },
      recipeId: normalRecipe.id,
      children,
    };
  }

  const handCauldronRecipe = chooseHandCauldronRecipe(itemId);
  if (handCauldronRecipe) {
    return {
      itemId,
      label,
      amount,
      status: 'handCauldron',
      reason: { ja: `手書き錬金釜レシピ ${handCauldronRecipe.id} は存在。錬金釜値データとの照合は未完了。`, en: `Manual cauldron recipe ${handCauldronRecipe.id} exists. It is not fully reconciled with cauldron values yet.` },
      recipeId: handCauldronRecipe.id,
      children: itemInputIds(handCauldronRecipe).map((input) => analyzeItem(input.itemId, input.amount * amount, startupItemIds, depth - 1, new Set([...seen, itemId]))),
    };
  }

  return {
    itemId,
    label,
    amount,
    status: 'missing',
    reason: { ja: '通常レシピ・錬金釜ターゲット・手書き錬金釜レシピのいずれも未確認', en: 'No normal recipe, cauldron target, or manual cauldron recipe is known' },
    children: [],
  };
}

function collectStatuses(root: CauldronPlanItem): { missing: string[]; cauldron: string[]; blocked: boolean; predictedOnly: boolean } {
  const missing: string[] = [];
  const cauldron: string[] = [];
  let blocked = false;
  let predictedOnly = false;

  function walk(node: CauldronPlanItem): void {
    if (node.status === 'missing') {
      blocked = true;
      missing.push(node.itemId);
    }
    if (node.status === 'depthLimit') predictedOnly = true;
    if (node.status === 'cauldronTarget') {
      cauldron.push(node.itemId);
      predictedOnly = true;
    }
    if (node.status === 'handCauldron') predictedOnly = true;
    for (const child of node.children) walk(child);
  }

  walk(root);
  return { missing: unique(missing), cauldron: unique(cauldron), blocked, predictedOnly };
}

export function analyzeCauldronTargets(targetItemIds: string[], startupItemIds: string[], maxDepth = 4): CauldronTargetPlan[] {
  const startupSet = new Set(startupItemIds);
  return targetItemIds.map((targetItemId) => {
    const root = analyzeItem(targetItemId, 1, startupSet, maxDepth, new Set());
    const summary = collectStatuses(root);
    const status = root.status === 'startup' ? 'startup' : summary.blocked ? 'blocked' : 'provisional';
    const confidence = summary.blocked ? 'blocked' : summary.predictedOnly ? 'predictedOnly' : 'partiallyVerified';
    return {
      targetItemId,
      targetLabel: labelForItem(targetItemId),
      status,
      confidence,
      root,
      missingItemIds: summary.missing,
      cauldronCandidateItemIds: summary.cauldron,
    };
  });
}

export function staticNormalRecipeCount(): number {
  return RECIPES.filter((recipe) => recipe.machineId !== 'cauldron' && recipe.machineId !== 'advanced_cauldron' && !recipe.internal).length;
}
