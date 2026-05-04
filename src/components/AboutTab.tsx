// @ts-nocheck
import type { Lang } from '../types';

const repoUrl = 'https://github.com/spaltfcy/alchemyfactory-calculator';

export function AboutTab({ lang }: { lang: Lang }) {
  if (lang === 'en') {
    return (
      <div className="about-tab stack">
        <section className="panel about-panel">
          <h2>About this tool</h2>
          <p>This is a fresh implementation of a small Alchemy Factory production planner for GitHub Pages.</p>
          <p>The initial recipe data is based on Alchemy Factory Codex pages and is intentionally small. Replace the data files after checking the latest in-game values.</p>
          <ul>
            <li>Graph / Table / Settings / About tabs</li>
            <li>Japanese / English UI</li>
            <li>Multiple production targets</li>
            <li>Items/min or machine-count targets</li>
            <li>Byproduct reuse / discard settings</li>
            <li>Conveyor count estimation</li>
            <li>Ability values saved and defined in editable arrays</li>
            <li>Double-click a graph node to toggle completed state</li>
          </ul>
          <p>
            GitHub: <a href={repoUrl} target="_blank" rel="noreferrer">{repoUrl}</a>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="about-tab stack">
      <section className="panel about-panel">
        <h2>このツールについて</h2>
        <p>GitHub Pages で使える Alchemy Factory 生産計画ツールの新規実装です。</p>
        <p>初期レシピは Alchemy Factory Codex ベースの少数データです。後でゲーム内最新値に合わせて data ファイルを差し替えてください。</p>
        <ul>
          <li>グラフ / 表 / 設定 / About タブ</li>
          <li>日本語 / 英語切り替え</li>
          <li>複数の最終出力</li>
          <li>生産数/min または 機械台数指定</li>
          <li>副産物の再利用 / 破棄</li>
          <li>ベルコン本数の逆算</li>
          <li>アビリティ保存と配列定義</li>
          <li>グラフノードのダブルクリックで作成済み切り替え</li>
        </ul>
        <p>
          GitHub: <a href={repoUrl} target="_blank" rel="noreferrer">{repoUrl}</a>
        </p>
      </section>
    </div>
  );
}
