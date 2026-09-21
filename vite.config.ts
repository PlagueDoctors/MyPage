import { defineConfig } from "vite";

// base: "./" 让产物同时适用于 GitHub Pages 项目页子路径与本地 file 预览。
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // three.js 单独切块，便于长期缓存
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/three") ? "three" : undefined),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
