import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// 构建产物输出到 web/dist，由 Worker 经 [assets] 托管（ADR-0010）。
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true },
});
