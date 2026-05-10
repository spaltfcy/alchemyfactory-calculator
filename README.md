# AlchemyFactory Calculator

Alchemy Factory 向けの生産計画ツールです。React + TypeScript + Vite で作られた静的Webアプリとして動作します。

## 現在のバージョン

- アプリ: `0.8.2`
- 計算エンジン: `balance-v082`
- 対象ゲームバージョン表示: `0.4.4.4323`

## 主な機能

- 複数の最終出力を `/min` または設備台数で指定
- 生産フローのグラフ表示と表形式表示
- 副産物の再利用 / 破棄表示
- 燃料・肥料を素材需要とは別の role として計算
- 外部燃料 / 外部肥料を購入ではなく外部生産扱いで分離
- 循環レシピに対する cycle input と代替レシピ補完
- JSON エクスポート / インポート
- DEBUG モードで計算ログ・検証ログを出力
- Safe mode で localStorage 書き込みを抑止

## v0.8.2 の肥料モデル

肥料を使うレシピは、通常の素材入力とは別に `nutrientInputPerRun` を持ちます。

```ts
nutrientInputPerRun?: number;
nutrientRunRateMode?: 'logisticsCap' | 'fixedTime';
```

### 通常ハーブ型: `logisticsCap`

通常ハーブは、肥料の `V/s` と物流効率によるベルコン速度の小さい方で生産速度が決まります。工場効率は通常ハーブの肥料計算には掛けません。

```txt
run/min = min(
  fertilizerNutrientsPerSec * 60 / nutrientInputPerRun,
  conveyorItemsPerMinute / totalOutputAmountPerRun
)
```

肥料消費量は、肥料効率込みの肥料1個あたり栄養値で計算します。

```txt
fertilizer/min = runsPerMinute * nutrientInputPerRun / effectiveFertilizerValue
```

### 世界樹型: `fixedTime`

世界樹は固定時間レシピとして扱います。肥料の `V/s` や物流効率では生産速度を変えず、`timeSec` から run/min を出します。

```txt
run/min = 60 / timeSec
fertilizer/min = runsPerMinute * nutrientInputPerRun / effectiveFertilizerValue
```

## 開発環境

- Node.js 22 系推奨
- npm

## セットアップ

```bash
npm install
```

## 開発サーバー

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

## データ定義

- レシピ: `src/data/recipes.ts`
- アイテム: `src/data/items.ts`
- 設備: `src/data/machines.ts`
- アビリティ表: `src/data/abilityTables.ts`
- 燃料データ: `src/data/heat.ts`
- 肥料データ: `src/data/fertilizer.ts`

売れないアイテムは `sellPriceCopper` を定義しません。購入できないアイテムは `buyPriceCopper` を定義しません。

## DEBUG / Safe mode

URLフラグで動作を切り替えます。

```txt
#DEBUG=ON
#SAFE
#SAFEMODE
```

DEBUG モードでは Debug タブが表示され、計算ログを出力できます。Safe mode では localStorage に自動保存しません。

## GitHub Pages 公開

このリポジトリは Vite の静的ビルドを GitHub Pages へ配信できます。

```bash
npm run build
```

`dist/` の内容を Pages の公開対象にします。GitHub Actions を使う場合は `.github/workflows/pages.yml` を確認してください。

## 既知の注意点

- 完全な線形計画ソルバではなく、収支ベースの反復 solver です。
- 外部燃料 / 外部肥料は購入コストを持たない外部生産扱いです。
- 価格・レシピ・日本語名はゲーム内最新値と差があれば `src/data/*` 側を更新してください。
- 液体余剰の厳密制御、マシン名の日本語名修正は今後の調整対象です。

## ライセンス

MIT License
