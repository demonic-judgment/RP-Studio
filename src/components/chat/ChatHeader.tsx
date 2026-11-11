import { memo } from "react";
import { ImageIcon, Plus, Settings2 } from "lucide-react";
import type { Character, Session } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconButton } from "../ui/Button";
import { Pill } from "../ui/Tabs";

export const ChatHeader = memo(function ChatHeader({
  character,
  session,
  imageEnabled,
  onToggleImage,
  onOpenLeft,
  onOpenSettings,
  onNewSession,
}: {
  character: Character;
  session: Session | null;
  /** 图生图开关：开启后主页出现悬浮画面组件 */
  imageEnabled: boolean;
  onToggleImage: () => void;
  onOpenLeft: () => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
}) {
  return (
    <header className="relative z-10 flex h-[62px] shrink-0 items-center gap-2 px-3 shadow-header sm:px-4">
      <div className="flex flex-1 items-center gap-1">
        <button
          onClick={onOpenLeft}
          aria-label="角色与会话"
          title="角色与会话"
          className="group flex h-9 items-center gap-1 rounded-xl px-inset-tight transition-colors hover:bg-surface-2"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-[10.5px] font-bold tracking-tight text-on-primary shadow-soft transition-transform group-hover:scale-105">
            RP
          </span>
        </button>
        <IconButton label="新建会话" onClick={onNewSession} className="h-9 w-9 hidden sm:inline-flex">
          <Plus size={17} />
        </IconButton>
      </div>

      <button
        onClick={onOpenLeft}
        className="group flex min-w-0 max-w-[52%] items-center gap-2.5 rounded-xl px-inset-lg py-2 transition-colors hover:bg-surface-2"
        title="切换角色与会话"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-surface-2 text-[16px] shadow-soft transition-transform group-hover:scale-105">
          {character.avatar}
        </span>
        <span className="min-w-0 text-left">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-fg">
              {session?.title ?? character.name}
            </span>
            {character.workflow?.enabled && (
              <Pill tone="primary" className="hidden shrink-0 sm:inline-flex">
                工作流
              </Pill>
            )}
          </span>
          <span className="block truncate text-[11px] text-fg-subtle">
            {character.name}
            {session?.messageCount ? ` · ${session.messageCount} 条消息` : ""}
          </span>
        </span>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1">
        <IconButton
          label={imageEnabled ? "关闭图生图" : "开启图生图"}
          onClick={onToggleImage}
          className={cn(
            "h-9 w-9",
            imageEnabled &&
              "bg-primary-container text-on-primary-container hover:bg-primary-container/70 hover:text-on-primary-container",
          )}
        >
          <ImageIcon size={17} />
        </IconButton>
        <IconButton label="设置" onClick={onOpenSettings} className="h-9 w-9">
          <Settings2 size={17} />
        </IconButton>
      </div>
    </header>
  );
});
