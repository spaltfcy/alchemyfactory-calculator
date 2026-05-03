# AlchemyFactory Calculator

Alchemy Factory 向けの生産計画ツールです。

このプロジェクトは、GitHub Pages で公開してブラウザ上で使うことを想定した React + TypeScript 製の静的 Web アプリです。既存の無ライセンス公開リポジトリのコードは流用せず、新規実装しています。

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

## GitHub Pages で公開する方法

1. このプロジェクトを GitHub リポジトリへ push します。
2. GitHub の Repository Settings → Pages を開きます。
3. Build and deployment の Source を `GitHub Actions` にします。
4. `main` ブランチへ push すると `.github/workflows/pages.yml` が実行されます。
5. Actions が成功すると、以下の形式で公開されます。

```text
https://<user-name>.github.io/<repository-name>/
```

このプロジェクトでは、GitHub Actions 側で `VITE_GH_REPO` にリポジトリ名を渡し、Vite の `base` を自動設定しています。

ローカルで GitHub Pages と同じ base path 条件で確認したい場合は、以下のように指定します。

```bash
VITE_GH_REPO=alchemyfactory-calculator npm run build
```

Windows PowerShell の場合:

```powershell
$env:VITE_GH_REPO="alchemyfactory-calculator"
npm run build
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
