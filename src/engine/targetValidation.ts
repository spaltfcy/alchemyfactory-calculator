import type { ProductionTarget } from '../types';
import { itemById } from '../data/items';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';
import type { UserMessageInput } from '../utils/userMessages';

export type NegativeTargetEntry = {
  targetId: string;
  recipeId: string;
  recipeNameJa: string;
  recipeNameEn: string;
  outputItemId: string;
  outputItemNameJa: string;
  outputItemNameEn: string;
  mode: ProductionTarget['mode'];
  value: number;
};

export type TargetSanitizationResult = {
  targets: ProductionTarget[];
  negativeTargets: NegativeTargetEntry[];
};

function targetRecipeName(target: ProductionTarget, lang: 'ja' | 'en'): string {
  const recipe = recipeById[target.recipeId];
  if (recipe) return text(recipe.name, lang);
  const item = itemById[target.outputItemId];
  if (item) return text(item.name, lang);
  return target.recipeId || target.outputItemId || target.id;
}

function targetOutputItemName(target: ProductionTarget, lang: 'ja' | 'en'): string {
  const item = itemById[target.outputItemId];
  if (item) return text(item.name, lang);
  return target.outputItemId || target.id;
}

export function sanitizeNegativeTargets(targets: ProductionTarget[]): TargetSanitizationResult {
  const negativeTargets: NegativeTargetEntry[] = [];
  const sanitizedTargets = targets.map((target) => {
    const value = Number(target.value);
    if (Number.isFinite(value) && value < 0) {
      negativeTargets.push({
        targetId: target.id,
        recipeId: target.recipeId,
        recipeNameJa: targetRecipeName(target, 'ja'),
        recipeNameEn: targetRecipeName(target, 'en'),
        outputItemId: target.outputItemId,
        outputItemNameJa: targetOutputItemName(target, 'ja'),
        outputItemNameEn: targetOutputItemName(target, 'en'),
        mode: target.mode,
        value,
      });
      return { ...target, value: 0 };
    }
    if (!Number.isFinite(value)) return { ...target, value: 0 };
    return { ...target, value };
  });

  return { targets: sanitizedTargets, negativeTargets };
}

function buildNegativeTargetLines(entries: NegativeTargetEntry[], lang: 'ja' | 'en'): string[] {
  const lines = entries.slice(0, 5).map((entry) => {
    const recipeName = lang === 'ja' ? entry.recipeNameJa : entry.recipeNameEn;
    return lang === 'ja'
      ? recipeName + 'のレシピの出力が負の値です。'
      : 'The output value for the ' + recipeName + ' recipe is negative.';
  });
  if (entries.length > 5) lines.push('...more');
  return lines;
}

export function buildNegativeTargetWarningInput(entries: NegativeTargetEntry[]): UserMessageInput | undefined {
  if (entries.length <= 0) return undefined;
  return {
    severity: 'warning',
    visibility: 'temporary',
    code: 'NEGATIVE_TARGET_VALUE_IGNORED',
    messageJa: buildNegativeTargetLines(entries, 'ja').join('\n'),
    messageEn: buildNegativeTargetLines(entries, 'en').join('\n'),
    durationMs: 5000,
    details: {
      ignoredTargetCount: entries.length,
      negativeTargets: entries,
    },
  };
}

export function filterPositiveTargets(targets: ProductionTarget[]): ProductionTarget[] {
  return targets.filter((target) => Number.isFinite(Number(target.value)) && Number(target.value) > 0);
}
