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
    // 关掉 modulepreload：Vite 的预加载助手会被静态引入动态 chunk，
    // 结果 PGlite 那 488KB 还是跟着首屏一起下来了。关掉之后
    // 它才是真正的按需加载 —— 首屏外壳先出来，数据库在后台起。
    modulePreload: false,
    rollupOptions: {
      output: {
        /**
         * 把长期不变的依赖拆成独立 chunk：
         * 改业务代码时这些文件的 hash 不变，用户只用重新下载几百字节的入口。
         * PGlite 已经是动态 import（见 lib/db.ts），这里再兜一层，保证它单独成块。
         */
        manualChunks(id: string) {
          // 动态 import 的预加载助手不能被塞进 PGlite 那一块：
          // 入口静态引用了这个助手，助手一旦落在 pglite chunk 里，
          // 整个 488KB 就退回成首屏同步加载。单独放一块，入口只引这小文件。
          // 注意它不在 node_modules 里（Vite 的虚拟模块），要放在下面的判断之前。
          if (id.includes("preload-helper")) return "preload";
          if (!id.includes("node_modules")) return;
          // PGlite 交给 Vite 自己切成动态 chunk，别被下面的 vendor 兜底捞走：
          // 一旦进了任何被静态引用的 chunk，488KB 就跟着首屏一起下来了。
          if (id.includes("@electric-sql/pglite")) return;
          
          if (id.includes("react-dom") || id.includes("scheduler") || id.includes("/react/")) {
            return "react";
          }
          if (id.includes("motion") || id.includes("framer-motion")) return "motion";
          if (id.includes("marked") || id.includes("dompurify")) return "markdown";
          return "vendor";
        },
      },
    },
  },
  server: { port: 5173, host: true },
});
