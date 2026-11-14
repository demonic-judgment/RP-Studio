import { useEffect } from "react";
import { useStore } from "./lib/store";
import { useWideLayout } from "./lib/hooks/use-wide-layout";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { cn } from "./lib/utils";
import { Backdrop } from "./components/home/Backdrop";
import { ChatView } from "./components/chat/ChatView";
import { ImageStage } from "./components/image/ImageStage";
import { LeftDrawer } from "./components/drawers/LeftDrawer";
import { Sidebar } from "./components/drawers/Sidebar";
import { SettingsDrawer } from "./components/drawers/SettingsDrawer";
import { SpaceDrawer } from "./components/drawers/SpaceDrawer";
import { CharacterEditor } from "./components/character/CharacterEditor";
import { Toasts } from "./components/ui/Toasts";
import { Button } from "./components/ui/Button";

export default function App() {
  const wide = useWideLayout();
  const ready = useStore((s) => s.ready);
  const initError = useStore((s) => s.initError);
  const init = useStore((s) => s.init);
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  /** 设了背景图时，内容列变成高斯模糊遮罩，让底图化成一团柔光透上来 */
  const hasBackground = useStore((s) => Boolean(s.settings.background?.url));

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    applyTheme(theme, accent);
    return watchSystemTheme(theme, accent, () => {
      // 系统主题变化时重新应用 CSS 变量
      applyTheme(theme, accent);
    });
  }, [theme, accent]);

  if (!ready) {
    return (
      <div className="relative flex h-full items-center justify-center">
        <Backdrop />
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 scale-150 rounded-full bg-primary/25 blur-2xl" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-[15px] font-bold text-on-primary shadow-float">
              RP
            </div>
          </div>
          <div className="text-center">
            <p className="text-[13px] font-medium text-fg">正在启动本地数据库</p>
            <p className="mt-1 text-[11.5px] text-fg-subtle">PGlite · WASM Postgres 首次加载稍慢</p>
          </div>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/2 shimmer rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="relative flex h-full items-center justify-center px-6">
        <Backdrop />
        <div className="max-w-[420px] rounded-3xl bg-surface p-inset-lg text-center shadow-card">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-lg">
            ⚠️
          </div>
          <h1 className="text-[16px] font-semibold text-fg">数据库启动失败</h1>
          <p className="mt-2 break-words text-[12.5px] leading-relaxed text-fg-muted">{initError}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
            可能是浏览器禁用了 IndexedDB，或处于无痕模式。
          </p>
          <Button variant="primary" className="mt-4 w-full" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <Backdrop />

      {/* 两个容器并排撑满整页：桌面端左栏常驻，窄屏左栏让位给抽屉 */}
      {wide ? <Sidebar /> : null}

      <div
        className={cn(
          "relative flex h-full min-w-0 flex-1 flex-col overflow-hidden",
          hasBackground
            ? "bg-surface/45 backdrop-blur-xl backdrop-saturate-150"
            : "bg-surface/55 backdrop-blur-[2px]",
        )}
      >
        <ChatView />
      </div>

      {/* 悬浮画面：开关打开时才出现，可拖拽 / 缩放，压在抽屉之下 */}
      <ImageStage />

      {wide ? null : <LeftDrawer />}
      <SettingsDrawer />
      <SpaceDrawer />
      <CharacterEditor />
      <Toasts />
    </div>
  );
}
