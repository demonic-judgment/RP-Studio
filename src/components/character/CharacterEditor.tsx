import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Plus, Save, Trash2 } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Character } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Drawer, DrawerHeader } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Form";
import { CharacterAvatar } from "./CharacterAvatar";

const AVATARS = ["🎭", "🌙", "🗡️", "🛰️", "🕯️", "🧝", "🧛", "🕵️", "🤖", "🦊", "🌸", "👑", "🌊", "🐉", "🏮", "🫧"];

/**
 * 角色编辑：空间里的一个具体角色。
 * 名字、开场白、专属提示词、用空间底图库哪一张 —— 共享的东西不在这里，在空间设置里。
 */
export function CharacterEditor() {
  const open = useStore((s) => s.drawer === "character");
  const openDrawer = useStore((s) => s.openDrawer);
  const character = useStore((s) => s.characters.find((c) => c.id === s.activeCharacterId) ?? null);
  const space = useStore((s) => s.spaces.find((s2) => s2.id === s.activeSpaceId) ?? null);
  // 别在 selector 里 filter：每次 store 更新都会返回新数组，等于关掉引用比较
  const characters = useStore((s) => s.characters);
  const activeSpaceId = useStore((s) => s.activeSpaceId);
  const siblings = useMemo(
    () => characters.filter((c) => c.spaceId === activeSpaceId),
    [characters, activeSpaceId],
  );
  const saveCharacter = useStore((s) => s.saveCharacter);
  const removeCharacter = useStore((s) => s.removeCharacter);
  const newSession = useStore((s) => s.newSession);

  const [draft, setDraft] = useState<Character | null>(character);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && character) {
      setDraft({ ...character });
      setConfirmDelete(false);
    }
  }, [open, character?.id, character?.updatedAt]);

  const dirty = useMemo(() => {
    if (!open || !draft || !character) return false;
    return JSON.stringify(draft) !== JSON.stringify(character);
  }, [open, draft, character]);

  if (!draft || !space) return null;

  const patch = (value: Partial<Character>) => setDraft({ ...draft, ...value });

  const seeds = (space.imageSeeds ?? []).filter(Boolean);
  const activeSeed = seeds.includes(draft.activeSeed) ? draft.activeSeed : seeds[0] ?? "";

  const requestClose = () => {
    if (dirty && !window.confirm("角色有未保存的修改，确定关闭？")) return;
    openDrawer(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveCharacter({
        id: draft.id,
        name: draft.name,
        avatar: draft.avatar,
        greeting: draft.greeting,
        systemPrompt: draft.systemPrompt,
        activeSeed,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      side="right"
      ariaLabel="角色编辑"
      className="w-[min(560px,100vw)]"
    >
      <DrawerHeader
        title={
          <span className="flex items-center gap-2">
            <CharacterAvatar
              seed={activeSeed}
              emoji={draft.avatar}
              className="w-[16px]"
              emojiSize={11}
            />
            {draft.name || "未命名角色"}
          </span>
        }
        subtitle={`${space.name} · 角色`}
        onClose={requestClose}
      >
        <Button
          variant={dirty ? "primary" : "ghost"}
          size="sm"
          disabled={!dirty || saving}
          onClick={save}
          leading={<Save size={13} />}
        >
          {saving ? "保存中…" : dirty ? "保存" : "已保存"}
        </Button>
      </DrawerHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <CharacterAvatar
              seed={activeSeed}
              emoji={draft.avatar}
              alt={draft.name}
              className="w-[72px] shadow-soft"
              rounded="rounded-2xl"
              emojiSize={30}
            />
            <div className="min-w-0 flex-1 space-y-2">
              {seeds.length ? (
                <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                  头像就是这个角色的底图（2:3 竖图）。想换头像就换一张底图；新图去空间设置的「基础」页上传。
                </p>
              ) : (
                <>
                  <Field label="占位 Emoji" hint="底图库还空着，先用它顶着头像">
                    <Input
                      value={draft.avatar}
                      onChange={(e) => patch({ avatar: e.target.value.slice(0, 4) })}
                      className="h-9 w-24 text-center text-lg"
                      maxLength={4}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {AVATARS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => patch({ avatar: emoji })}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-lg text-[15px] transition-colors hover:bg-surface-2",
                          draft.avatar === emoji && "bg-primary-container",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <Field label="角色名">
            <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>

          <Field
            label="角色底图"
            hint={
              seeds.length
                ? "从空间底图库里挑一张：图生图每轮都拿它重新画，画面变化只来自提示词。要加新图去空间设置的「基础」页上传"
                : "空间底图库还是空的。先去空间设置的「基础」页传一张正面全身照，再回来选"
            }
          >
            {seeds.length ? (
              <div className="flex flex-wrap gap-2">
                {seeds.map((src) => {
                  const selected = src === activeSeed;
                  return (
                    <button
                      key={src}
                      type="button"
                      onClick={() => patch({ activeSeed: src })}
                      title={selected ? "当前使用中" : "设为这个角色的底图"}
                      aria-label={selected ? "当前底图" : "设为这个角色的底图"}
                      className={cn(
                        "block aspect-[2/3] w-[62px] overflow-hidden rounded-lg border transition-all",
                        selected
                          ? "border-primary ring-2 ring-primary/25"
                          : "border-line opacity-75 hover:border-primary/40 hover:opacity-100",
                      )}
                    >
                      <img src={src} alt="底图候选" className="h-full w-full object-cover" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex aspect-[2/3] w-[62px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line/80 bg-surface-2 text-[10.5px] text-fg-subtle">
                <ImageIcon size={16} />
                未选择
              </div>
            )}
          </Field>

          <div className="space-y-2">
            <Field
              label="初始消息"
              hint="新建会话时自动写入的第一条角色消息，支持 {{char}} / {{user}}；留空就显示角色介绍页"
            >
              <Textarea
                value={draft.greeting}
                onChange={(e) => patch({ greeting: e.target.value })}
                className="min-h-[116px] text-[12.5px] leading-relaxed"
                placeholder={"（她抬眼，把伞往你那边偏了偏。）\n\n「这么大的雨，站这儿等人？」"}
              />
            </Field>
            {draft.greeting.trim() && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11.5px]"
                onClick={async () => {
                  await save();
                  await newSession(draft.id);
                }}
                leading={<Plus size={12} />}
              >
                保存并新建开场会话
              </Button>
            )}
          </div>

          <Field
            label="角色设定"
            hint="只对这个角色生效；会话首页会展示这段文字。空间共享的设定写在空间设置里"
          >
            <Textarea
              value={draft.systemPrompt}
              onChange={(e) => patch({ systemPrompt: e.target.value })}
              className="min-h-[200px] text-[12.5px] leading-relaxed"
              placeholder="你是……，性格……，说话……"
            />
          </Field>

          <div className="border-t border-line pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  leading={<Trash2 size={13} />}
                  onClick={async () => {
                    await removeCharacter(draft.id);
                    setConfirmDelete(false);
                    openDrawer(null);
                  }}
                >
                  确认删除角色（含它的会话）
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                leading={<Trash2 size={13} />}
                disabled={siblings.length <= 1}
                onClick={() => setConfirmDelete(true)}
              >
                {siblings.length <= 1 ? "空间里至少要留一个角色" : "删除角色"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-5 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-fg-subtle">
            {dirty ? "有未保存的修改" : `上次保存 ${new Date(draft.updatedAt).toLocaleString("zh-CN")}`}
          </p>
          <div className="flex items-center gap-1.5">
            {character && dirty && (
              <Button variant="ghost" size="sm" onClick={() => setDraft({ ...character })}>
                还原
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} disabled={!dirty || saving}>
              保存角色
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
