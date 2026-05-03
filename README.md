# Alchemy Factory Planner JA v0.1

GitHub Pages で使うことを想定した、Alchemy Factory 用の生産計画ツールです。

既存リポジトリのコードは流用せず、v0.1 として新規実装しています。
初期レシピは Codex に掲載されている実在レシピを少数だけ入れています。後でゲーム内最新値に合わせて `src/data/*.ts` を差し替えてください。

## 機能

- 日本語 / 英語切り替え
- グラフ / 表 / 設定 / About タブ
- 複数の最終出力
- 生産数/min または 機械台数指定
- 同一最終出力の合算
- デフォルトは自作、作れない素材は購入
- 副産物の再利用 / 破棄
- 設備数丸め
  - 無効
  - 中間設備のみ整数化
  - 全設備整数化
- 過剰生産量の表示
- ベルトコンベア本数の逆算
- 原材料購入コスト/min、売上/min、利益/min
- アビリティを全項目保存
- グラフノードをダブルクリックして作成済み表示
- localStorage 自動保存
- JSON エクスポート / インポート

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

GitHub Pages のリポジトリページに出す場合は、GitHub Actions 側で `VITE_GH_REPO` にリポジトリ名を入れています。
ローカルで同じ条件にしたい場合は以下です。

```bash
VITE_GH_REPO=your-repository-name npm run build
```

Windows PowerShell の場合:

```powershell
$env:VITE_GH_REPO="your-repository-name"
npm run build
```

## GitHub Pages 設定

1. GitHub にこのプロジェクトを push
2. Repository Settings → Pages
3. Source を `GitHub Actions` に変更
4. `main` ブランチに push

`.github/workflows/pages.yml` が `dist` を GitHub Pages にデプロイします。

## データ差し替え場所

### レシピ

`src/data/recipes.ts`

```ts
export const RECIPES = [ ... ];
```

### アイテム

`src/data/items.ts`

### 設備

`src/data/machines.ts`

### 価格

`src/data/economy.ts`

売れないアイテムは `sellPriceCopper` を定義しません。
購入できない、または価格未確認のものは `buyPriceCopper` を定義しません。

```ts
{ itemId: 'logs', buyPriceCopper: 200 }
{ itemId: 'charcoal', sellPriceCopper: 8 }
```

### アビリティ変動値

`src/data/abilityTables.ts`

配列は「レベルごとの加算値」です。
ゲーム内最新値と違う場合は、ここだけ修正してください。

```ts
logisticsEfficiency: {
  conveyorItemsPerMinuteAdd: [0.0, 15.0, 15.0, 15.0]
}
```

## v0.1 の注意

- 初期レシピは少数です。
- 副産物再利用は現在の計算順に依存します。
- 循環レシピや完全最適化は未対応です。
- 価格データは後でゲーム内確認に合わせて差し替える前提です。
- 売れないアイテムは `sellPriceCopper` 未定義として扱います。

## 初期収録レシピ

- Plank
- Gloom Fungus and Plank
- Coal
- Charcoal
- Charcoal Powder
- Stone and Coal

## ライセンス

必要に応じて `LICENSE` を追加してください。自作公開前提なら MIT などを推奨します。
