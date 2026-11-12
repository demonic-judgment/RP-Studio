import { useStore } from "../../lib/store";
import { Drawer } from "../ui/Drawer";
import { LeftPanel } from "./LeftPanel";

/**
 * 移动端的角色与会话抽屉。桌面端不用它 —— 那里是常驻侧边栏（Sidebar）。
 */
export function LeftDrawer() {
  const open = useStore((s) => s.drawer === "left");
  const openDrawer = useStore((s) => s.openDrawer);

  const close = () => openDrawer(null);

  return (
    <Drawer open={open} onClose={close} side="left" ariaLabel="角色与会话" className="w-[min(348px,100vw)]">
      <LeftPanel onClose={close} />
    </Drawer>
  );
}
