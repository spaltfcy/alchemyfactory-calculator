# AlchemyFactory Calculator

Alchemy Factory 向けの生産計画ツールです。

このプロジェクトは、ブラウザ上で使うことを想定した React + TypeScript 製の静的 Web アプリです。

## 機能

- 日本語 / 英語切り替え
- グラフ / 表 / 設定 / About タブ
- 複数の最終出力指定
- 生産数/min または 機械台数指定
- 同一最終出力の合算
- デフォルトは自作、作れない素材は購入扱い
- 副産物の再利用 / 破棄
- 設備数丸め
  - 無効
  - 中間設備のみ整数化
  - 全設備整数化
- 過剰生産量の表示
- ベルトコンベア本数の逆算
- 原材料購入コスト/min、売上/min、利益/min
- アビリティ全項目の保存
- グラフノードのダブルクリックによる作成済み表示
- localStorage 自動保存
- JSON エクスポート / インポート

## 開発環境

- Node.js 22 系推奨
- npm

## セットアップ

```bash
npm install
```

## 開発サーバー起動

```bash
npm run dev
```

## ビルド

```bash
npm run build
```

## プレビュー

```bash
npm run preview
```

## データ差し替え場所

### レシピ

`src/data/recipes.ts`

### アイテム

`src/data/items.ts`

### 設備

`src/data/machines.ts`

### 価格

`src/data/economy.ts`

売れないアイテムは `sellPriceCopper` を定義しません。購入できない、または価格未確認のものは `buyPriceCopper` を定義しません。

```ts
{ itemId: 'logs', buyPriceCopper: 200 }
{ itemId: 'charcoal', sellPriceCopper: 8 }
```

### アビリティ変動値

`src/data/abilityTables.ts`

配列は「レベルごとの加算値」です。ゲーム内最新値と違う場合は、このファイルを修正してください。

```ts
logisticsEfficiency: {
  conveyorItemsPerMinuteAdd: [0.0, 15.0, 15.0, 15.0]
}
```

## 初期収録レシピ

v0.1 系では、動作確認用として Codex ベースの少数レシピのみを収録しています。

- Plank
- Gloom Fungus and Plank
- Coal
- Charcoal
- Charcoal Powder
- Stone and Coal

## 注意事項

- 初期レシピ数は少なめです。
- 循環レシピや完全最適化は未対応です。
- 副産物再利用は現在の計算順に依存します。
- 価格・アビリティ値・レシピ値は、後でゲーム内最新情報に合わせて差し替える前提です。
- 売れないアイテムは `sellPriceCopper` 未定義として扱います。

## ライセンス

MIT License
