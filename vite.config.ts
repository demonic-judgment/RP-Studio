import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 与 shadcn/ui CLI 的 "@/*" 别名保持一致
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // PGlite 通过 new URL('...wasm', import.meta.url) 加载 WASM 资源，
  // 交给 Vite 处理，不走预构建，避免资源路径错乱。
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5173, host: true },
});
