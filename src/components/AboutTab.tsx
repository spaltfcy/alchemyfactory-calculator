// @ts-nocheck
import type { Lang } from '../types';

const repoUrl = 'https://github.com/spaltfcy/alchemyfactory-calculator';
const safeModeUrl = 'https://spaltfcy.github.io/alchemyfactory-calculator/#safemode';

export function AboutTab({ lang }: { lang: Lang }) {
  if (lang === 'en') {
    return (
      <section className="panel about-panel">
        <h2>About this tool</h2>

        <p>This is an Alchemy Factory production planner that runs on GitHub Pages.</p>

        <p>If you find bugs or incorrect recipes, please report them on GitHub.</p>

        <h3>Features</h3>
        <ul className="about-feature-list">
          <li>Multiple production targets</li>
          <li>Items/min or machine-count targets</li>
          <li>Machine count and conveyor count estimation</li>
          <li>Byproduct reuse / discard settings</li>
          <li>Fuel calculation</li>
          <li>Graph and table views</li>
          <li>JSON save / load</li>
          <li>Auto-save for recipes and settings</li>
          <li>
            When opening multiple tabs, using <a href={safeModeUrl}>SafeMode</a> is recommended because it disables auto-save.
          </li>
        </ul>

        <p>
          GitHub: <a href={repoUrl}>{repoUrl}</a>
        </p>
      </section>
    );
  }

  return (
    <section className="panel about-panel">
      <h2>このツールについて</h2>

      <p>GitHub Pages で使える Alchemy Factory 生産計画ツールです。</p>

      <p>不具合やレシピの間違え等ありましたら GitHub で報告してください。</p>

      <h3>機能</h3>
      <ul className="about-feature-list">
        <li>複数アイテムの生産計画</li>
        <li>生産数/min または機械台数指定</li>
        <li>必要設備数とベルコン本数の計算</li>
        <li>副産物の再利用 / 破棄</li>
        <li>燃料計算</li>
        <li>グラフ表示 / 表表示</li>
        <li>JSON保存 / 読込</li>
        <li>レシピと設定の自動保存</li>
        <li>
          複数タブ起動する場合は <a href={safeModeUrl}>SafeMode</a> で実行すると自動保存が無効化されるのでおすすめです。
        </li>
      </ul>

      <p>
        GitHub: <a href={repoUrl}>{repoUrl}</a>
      </p>
    </section>
  );
}
