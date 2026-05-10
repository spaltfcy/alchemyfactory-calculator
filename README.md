# AlchemyFactory Calculator

Alchemy Factory 向けの生産計画ツールです。

React + TypeScript + Vite で作成した、ブラウザ上で動く静的 Web アプリです。

## 現在のバージョン

- App: v0.8.1
- Game data target: 0.4.4.4323
- State schema: 23
- Debug schema: 16
- Solver engine: `balance-v081`

## 主な機能

- 日本語 / 英語表示切り替え
- グラフ / 表 / 設定 / About / DEBUG タブ
- 複数の最終出力指定
- 出力/min または 設備台数指定
- レシピ選択の固定
- 収支ベースの非再帰 balance solver
- 購入可能アイテムによる循環補填 `cycleInput`
- 選択レシピ循環の検出
- 代替レシピ補完 ON / OFF
- 燃料と肥料の内部生産 / 外部生産
- 副産物燃料の利用 ON / OFF
- role/source 分離
  - 通常素材購入
  - 外部燃料
  - 外部肥料
  - 循環補填
- 余剰 / 破棄 / 最終出力ノードのグラフ表示
- 液体・蒸気をパイプ搬送として扱う表示
- localStorage 自動保存
- Safe mode: `#SAFE` または `#SAFEMODE`
- DEBUG mode: `#DEBUG=ON`
- JSON設定保存 / 読み込み
- DEBUGログ保存
- 検証JSON読み込み & ログ保存

## v0.8.1 の整理内容

- `v0.8.0-pre` 表記を `v0.8.1` に統一しました。
- solver engine ID を `balance-v081` に更新しました。
- app / game / state / debug schema の定数を `src/appMetadata.ts` に集約しました。
- 保存データ・インポートJSONの旧形式判定を共通化しました。
- import / load 時に未知の古いトップレベル項目を state へ再混入させないよう、明示的な AppState 正規化へ寄せました。
- `DebugTab` の import merge にあった重複プロパティを整理しました。
- 旧solver比較経路は復活させていません。
- `itemSourceModes` / `stockOverrides` は旧JSON拒否判定用の検出名としてのみ残します。
- 数量丸め設定とグラフ詳細度設定は復活させません。表示上の極小正値は 0.01/min 表示へ切り上げる方針です。

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

| 種類 | ファイル |
| --- | --- |
| レシピ | `src/data/recipes.ts` |
| アイテム | `src/data/items.ts` |
| 設備 | `src/data/machines.ts` |
| 価格 | `src/data/economy.ts` |
| アビリティ | `src/data/abilityTables.ts` |
| 燃料値 / 熱需要 | `src/data/heat.ts` |
| 肥料値 | `src/data/fertilizer.ts` |

売れないアイテムは `sellPriceCopper` を定義しません。購入できない、または価格未確認のものは `buyPriceCopper` を定義しません。

## 保存形式

v0.8.1 では `state.version = 23` を現在形式として扱います。

読み込み可能な範囲は `src/appMetadata.ts` の以下で管理します。

```ts
export const STATE_SCHEMA_VERSION = 23;
export const MIN_SUPPORTED_STATE_SCHEMA_VERSION = 22;
```

旧形式として拒否する代表例です。

- `itemSourceModes` を含むJSON
- `stockOverrides` を含むJSON
- `settings.fuel.fuelSourceMode` を含むJSON
- `settings.fertilizer.fertilizerSourceMode` を含むJSON
- state schema が未定義、古すぎる、または未来版のJSON

## 既知の保留事項

- 肥料レシピ / 肥料消費のゲーム内値との照合
- 一部マシン名の日本語名確認
- 液体余剰のさらに厳密な制御
- 完全な線形計画ソルバ化は未実装です。現在は balance iterative solver です。

## GitHub Pages

`vite.config.ts` の `base` は `/alchemyfactory-calculator/` です。

通常は main へ push すると GitHub Actions で Pages 用ビルドが走ります。

## ライセンス

MIT License
