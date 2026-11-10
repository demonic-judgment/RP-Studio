import { useMemo, useState } from "react";
import { MessageSquarePlus, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useStore } from "../../lib/store";
import { Drawer } from "../ui/Drawer";
import { Button, IconButton } from "../ui/Button";
import { cn, relativeTime } from "../../lib/utils";

export function LeftDrawer() {
  const open = useStore((s) => s.drawer === "left");
  const openDrawer = useStore((s) => s.openDrawer);
  const characters = useStore((s) => s.characters);
  const sessions = useStore((s) => s.sessions);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const selectCharacter = useStore((s) => s.selectCharacter);
  const selectSession = useStore((s) => s.selectSession);
  const newSession = useStore((s) => s.newSession);
  const removeSession = useStore((s) => s.removeSession);
  const renameSession = useStore((s) => s.renameSession);
  const pinSession = useStore((s) => s.pinSession);
  const createCharacter = useStore((s) => s.createCharacter);

  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const activeCharacter = characters.find((c) => c.id === activeCharacterId) ?? null;

  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.tagline.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [characters, query]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const close = () => openDrawer(null);

  const updateSessionPin = async (id: string, pinned: boolean) => {
    await pinSession(id, pinned);
  };

  return (
    <Drawer open={open} onClose={close} side="left" ariaLabel="角色与会话" className="w-[min(348px,100vw)]">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-on-primary shadow-soft">
            RP
          </div>
          <div>
            <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">RP-Studio</p>
            <p className="text-[10.5px] text-fg-subtle">角色扮演工作室</p>
          </div>
        </div>
        <IconButton label="关闭" onClick={close}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色或会话"
            className="h-9 w-full rounded-xl border border-line bg-surface-2/60 pl-8.5 pr-3 text-[12.5px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-[var(--ring)]/12"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <SectionLabel
          action={
            <IconButton label="新建角色" onClick={() => void createCharacter()} className="h-7 w-7">
              <Plus size={14} />
            </IconButton>
          }
        >
          角色
        </SectionLabel>

        <div className="mb-3 space-y-0.5 px-1">
          {filteredCharacters.map((character) => {
            const active = character.id === activeCharacterId;
            return (
              <div
                key={character.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
                  active ? "bg-primary-container" : "hover:bg-surface-2",
                )}
                onClick={() => void selectCharacter(character.id)}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border text-[17px]",
                    active ? "border-primary/25 bg-surface" : "border-line bg-surface",
                  )}
                >
                  {character.avatar}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[13px] font-medium",
                      active ? "text-on-primary-container" : "text-fg",
                    )}
                  >
                    {character.name}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle">
                    {character.tagline || "暂无简介"}
                  </p>
                </div>
                <IconButton
                  label="编辑角色卡"
                  className="h-7 w-7 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void selectCharacter(character.id);
                    openDrawer("character");
                  }}
                >
                  <Pencil size={13} />
                </IconButton>
              </div>
            );
          })}
          {filteredCharacters.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-fg-subtle">没有匹配的角色</p>
          )}
        </div>

        <SectionLabel
          action={
            <IconButton label="新建会话" onClick={() => void newSession()} className="h-7 w-7">
              <MessageSquarePlus size={14} />
            </IconButton>
          }
        >
          会话{activeCharacter ? ` · ${activeCharacter.name}` : ""}
        </SectionLabel>

        <div className="space-y-0.5 px-1">
          {filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => {
                  if (renaming === session.id) return;
                  void selectSession(session.id);
                  close();
                }}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 transition-colors",
                  active ? "bg-surface-2" : "hover:bg-surface-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  {renaming === session.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        void renameSession(session.id, renameValue);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void renameSession(session.id, renameValue);
                          setRenaming(null);
                        }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded-md border border-primary/40 bg-surface px-1.5 py-0.5 text-[12.5px] outline-none"
                    />
                  ) : (
                    <p
                      className={cn(
                        "truncate text-[12.5px]",
                        active ? "font-medium text-fg" : "text-fg-muted",
                      )}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenaming(session.id);
                        setRenameValue(session.title);
                      }}
                    >
                      {session.pinned && <Pin size={10} className="mr-1 inline text-primary" />}
                      {session.title}
                    </p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-subtle">
                    <span>{relativeTime(session.updatedAt)}</span>
                    {session.messageCount ? <span>· {session.messageCount} 条</span> : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <IconButton
                    label="重命名"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(session.id);
                      setRenameValue(session.title);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton
                    label={session.pinned ? "取消置顶" : "置顶"}
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      void updateSessionPin(session.id, !session.pinned);
                    }}
                  >
                    <Pin size={12} />
                  </IconButton>
                  <IconButton
                    label="删除会话"
                    className="h-6 w-6 hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        session.messageCount &&
                        session.messageCount > 0 &&
                        !window.confirm(`删除会话「${session.title}」及其 ${session.messageCount} 条消息？此操作不可撤销。`)
                      ) {
                        return;
                      }
                      void removeSession(session.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              </div>
            );
          })}
          {filteredSessions.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-fg-subtle">还没有会话</p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        <Button
          variant="soft"
          size="sm"
          className="w-full"
          onClick={() => openDrawer("character")}
          leading={<Pencil size={13} />}
        >
          编辑当前角色卡
        </Button>
        <p className="mt-2 text-center text-[10.5px] leading-relaxed text-fg-subtle">
          数据保存在浏览器本地 · PGlite
        </p>
      </div>
    </Drawer>
  );
}

function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        {children}
      </span>
      {action}
    </div>
  );
}
