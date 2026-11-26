import { defineConfig } from 'vite';

// GitHub Pages では /<リポジトリ名>/ 配下に置かれる。Actions から BASE_PATH を渡す。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
});
