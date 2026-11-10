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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
