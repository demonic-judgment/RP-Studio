import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initDb } from "./lib/db";
import "./index.css";

// 先启动 PGlite（并行下载 WASM），再挂载界面；App 内部仍有 loading 态兜底
void initDb().catch((err) => {
  console.error("PGlite 初始化失败", err);
});

// 版本自愈的收尾：index.html 的守卫发现入口脚本加载失败时，会带 ?v=<随机> 重载一次
// 以绕开浏览器里的旧 HTML。能走到这里说明这一次加载成功了 —— 清掉重载标记（否则下次
// 真遇到版本错位就不再自救），并把那个临时参数从地址栏抹掉。
try {
  sessionStorage.removeItem("rp.asset-reload");
  const url = new URL(location.href);
  if (url.searchParams.has("v")) {
    url.searchParams.delete("v");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
} catch {
  /* 隐私模式下 sessionStorage 可能不可用，忽略 */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
