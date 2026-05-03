declare const process: { env: Record<string, string | undefined> };
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages のリポジトリページに出す場合は、以下の環境変数を設定してください。
// 例: VITE_GH_REPO=alchemy-factory-ja npm run build
const repo = process.env.VITE_GH_REPO;

export default defineConfig({
  plugins: [react()],
  base: repo ? `/${repo}/` : './',
});
