import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages のサブパスでも動くよう相対パスで書き出す
  base: './',
  server: {
    // ../samples/bodies のサンプル JSON を読み込むため
    fs: { allow: ['..'] },
  },
});
