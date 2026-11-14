import { useMemo, useState } from "react";
import { MessageSquarePlus, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import { CharacterAvatar, characterSeed } from "../character/CharacterAvatar";
import { cn, relativeTime } from "../../lib/utils";

/**
 * 左栏正文：空间（一级）→ 角色（二级）→ 会话 三段。
 * 桌面端常驻侧边栏和移动端遮罩抽屉共用这一份，两边只换外壳，
 * 所以这里只负责内容，不带任何定位 / 尺寸 / 进出场动画。
 *
 * `onClose` 只在抽屉里传：桌面没有「关掉左栏」这回事。
 */
export function LeftPanel({ onClose }: { onClose?: () => void }) {
  const spaces = useStore((s) => s.spaces);
  const characters = useStore((s) => s.characters);
  const sessions = useStore((s) => s.sessions);
  const activeSpaceId = useStore((s) => s.activeSpaceId);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const selectSpace = useStore((s) => s.selectSpace);
  const selectCharacter = useStore((s) => s.selectCharacter);
  const selectSession = useStore((s) => s.selectSession);
  const newSession = useStore((s) => s.newSession);
  const removeSession = useStore((s) => s.removeSession);
  const renameSession = useStore((s) => s.renameSession);
  const pinSession = useStore((s) => s.pinSession);
  const createSpace = useStore((s) => s.createSpace);
  const removeSpace = useStore((s) => s.removeSpace);
  const createCharacter = useStore((s) => s.createCharacter);
  const openDrawer = useStore((s) => s.openDrawer);
  const streaming = useStore((s) => s.stream.running);

  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const q = query.trim().toLowerCase();

  const spaceCharacters = useMemo(
    () => characters.filter((c) => c.spaceId === activeSpaceId),
    [characters, activeSpaceId],
  );

  const filteredSpaces = useMemo(() => {
    if (!q) return spaces;
    const hitSpaceIds = new Set<string>([
      ...characters
        .filter((c) => c.name.toLowerCase().includes(q) || c.systemPrompt.toLowerCase().includes(q))
        .map((c) => c.spaceId),
      // 会话命中也留着它的空间，否则列表里的会话会没有上级节点
      ...sessions.filter((s) => s.title.toLowerCase().includes(q)).map((s) => s.spaceId),
    ]);
    return spaces.filter((s) => s.name.toLowerCase().includes(q) || hitSpaceIds.has(s.id));
  }, [spaces, characters, sessions, q]);

  /** 二级列表按空间分组取角色：只分一次组，别让每个空间各扫一遍 characters */
  const charactersBySpace = useMemo(() => {
    const map = new Map<string, Character[]>();
    for (const c of characters) {
      const list = map.get(c.spaceId);
      if (list) list.push(c);
      else map.set(c.spaceId, [c]);
    }
    return map;
  }, [characters]);

  const filteredSessions = useMemo(() => {
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, q]);

  const activeCharacter = spaceCharacters.find((c) => c.id === activeCharacterId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[62px] shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-on-primary shadow-soft">
            RP
          </div>
          <div>
            <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">RP-Studio</p>
            <p className="text-[10.5px] text-fg-subtle">角色扮演工作室</p>
          </div>
        </div>
        {onClose && (
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索空间、角色或会话"
            className="h-9 w-full rounded-xl bg-surface-2 pl-8.5 pr-inset-lg text-[12.5px] text-fg outline-none transition-shadow placeholder:text-fg-subtle focus:ring-4 focus:ring-[var(--ring)]/12"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <SectionLabel
          action={
            <IconButton label="新建空间" onClick={() => void createSpace()} className="h-7 w-7">
              <Plus size={14} />
            </IconButton>
          }
        >
          空间
        </SectionLabel>

        <div className="mb-3 space-y-0.5 px-1">
          {filteredSpaces.map((space) => {
            const active = space.id === activeSpaceId;
            const kids = charactersBySpace.get(space.id) ?? [];
            const shownKids = q
              ? kids.filter(
                  (c) =>
                    c.name.toLowerCase().includes(q) || c.systemPrompt.toLowerCase().includes(q),
                )
              : kids;
            // 平时只展开当前空间；搜索时只摊开真的命中了角色的空间
            const expanded = q ? shownKids.length > 0 : active;
            return (
              <div key={space.id}>
                <div
                  className={cn(
                    "group flex cursor-pointer items-center gap-2.5 rounded-xl px-inset-lg py-2.5 transition-colors",
                    active ? "bg-primary-container" : "hover:bg-surface-2",
                  )}
                  onClick={() => void selectSpace(space.id)}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[17px]",
                      active ? "bg-surface" : "bg-surface-2",
                    )}
                  >
                    {space.avatar}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-[13px] font-medium",
                        active ? "text-on-primary-container" : "text-fg",
                      )}
                    >
                      {space.name}
                    </p>
                    <p className="truncate text-[11px] text-fg-subtle">{kids.length} 个角色</p>
                  </div>
                  <IconButton
                    label="空间设置"
                    className="h-7 w-7 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      // 设置抽屉读的是 activeSpaceId：设置别的空间要先切过去，
                      // 等切换完成再开抽屉，否则抽屉会先拿旧空间的草稿渲染一帧。
                      // 已经在当前空间时不要切，切一下会把正在看的会话顶掉。
                      if (space.id === activeSpaceId) {
                        openDrawer("space");
                      } else {
                        void selectSpace(space.id).then(() => openDrawer("space"));
                      }
                    }}
                  >
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton
                    label="删除空间"
                    className="h-7 w-7 opacity-100 transition-opacity hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                    disabled={streaming}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        !window.confirm(
                          `删除空间「${space.name}」及其全部角色、会话与消息？此操作不可撤销。`,
                        )
                      ) {
                        return;
                      }
                      void removeSpace(space.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>

                {expanded && (
                  <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-line pl-1.5">
                    {shownKids.map((character) => {
                      const charActive = character.id === activeCharacterId;
                      return (
                        <div
                          key={character.id}
                          className={cn(
                            "group flex items-center gap-0.5 rounded-lg pr-0.5 transition-colors",
                            charActive ? "bg-surface-2" : "hover:bg-surface-2",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => void selectCharacter(character.id)}
                            title={character.name}
                            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1.5"
                          >
                            <CharacterAvatar
                              seed={characterSeed(character, space)}
                              emoji={character.avatar}
                              className="w-[15px] bg-surface"
                              emojiSize={10}
                            />
                            <span
                              className={cn(
                                "truncate text-[12.5px]",
                                charActive ? "font-medium text-fg" : "text-fg-muted",
                              )}
                            >
                              {character.name}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`编辑角色「${character.name}」`}
                            title={`编辑「${character.name}」`}
                            onClick={async () => {
                              // 抽屉读的是 activeCharacterId：编辑别的角色要先切过去再开，
                              // 否则抽屉会先拿上一个角色的草稿渲染一帧。
                              if (!charActive) await selectCharacter(character.id);
                              openDrawer("character");
                            }}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-fg-subtle opacity-60 transition hover:bg-black/6 hover:text-fg hover:opacity-100 dark:hover:bg-white/12"
                          >
                            <Pencil size={10} />
                          </button>
                        </div>
                      );
                    })}
                    {shownKids.length === 0 && (
                      <p className="px-2 py-1 text-[11.5px] text-fg-subtle">还没有角色</p>
                    )}
                    {!q && active && (
                      <button
                        type="button"
                        onClick={() => void createCharacter()}
                        className="flex w-full items-center gap-1.5 rounded-lg py-1 pl-1.5 text-[11.5px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        <Plus size={11} />
                        新建角色
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredSpaces.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-fg-subtle">没有匹配的空间</p>
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
                  onClose?.();
                }}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-xl px-inset-lg py-2.5 transition-colors",
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
                      className="w-full rounded-md bg-surface-2 px-inset-sm py-1 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--ring)]/20"
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
                      void pinSession(session.id, !session.pinned);
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
                        !window.confirm(
                          `删除会话「${session.title}」及其 ${session.messageCount} 条消息？此操作不可撤销。`,
                        )
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
          className="w-full justify-center"
          onClick={() => openDrawer("space")}
          leading={<Pencil size={13} />}
        >
          空间设置
        </Button>
        <p className="mt-2 text-center text-[10.5px] leading-relaxed text-fg-subtle">
          数据只保存在这台设备上
        </p>
      </div>
    </div>
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
