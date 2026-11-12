import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { LeftPanel } from "./LeftPanel";

/**
 * 桌面端常驻左侧边栏：不可收纳，和聊天区一起撑满整个窗口。
 * 窄屏不渲染它（App 里按断点二选一），那边仍然用遮罩式抽屉。
 */
export function Sidebar() {
  const drawer = useStore((s) => s.drawer);
  const openDrawer = useStore((s) => s.openDrawer);

  // 从窄屏拖宽时左抽屉可能还开着：它已经不该存在了，
  // 留着会让背景光斑一直停在 frozen 状态（Backdrop 认的是 drawer !== null）。
  useEffect(() => {
    if (drawer === "left") openDrawer(null);
  }, [drawer, openDrawer]);

  return (
    <aside
      aria-label="角色与会话"
      className="relative z-10 hidden h-full w-[304px] shrink-0 flex-col border-r border-line bg-surface-2/60 backdrop-blur-xl backdrop-saturate-150 lg:flex"
    >
      <LeftPanel />
    </aside>
  );
}
