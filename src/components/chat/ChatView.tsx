import { useCallback, useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Button } from "../ui/Button";
import { Sparkles } from "lucide-react";

export function ChatView() {
  const characters = useStore((s) => s.characters);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  // 只订阅「这条会话是否正在生成」这个布尔值：整份 stream 对象每个 chunk 都会换引用，
  // 订了它会让顶部栏、输入层跟着每个 chunk 重渲染一遍。
  const streaming = useStore((s) => s.stream.running && s.stream.sessionId === s.activeSessionId);
  const openDrawer = useStore((s) => s.openDrawer);
  const newSession = useStore((s) => s.newSession);
  const createCharacter = useStore((s) => s.createCharacter);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const imageEnabled = useStore((s) => s.settings.imageEnabled);
  const setImageEnabled = useStore((s) => s.setImageEnabled);

  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState(140);
  const handleComposerHeight = useCallback((height: number) => setComposerHeight(height), []);
  // 快捷语回填只在点的时候用，引用必须稳定：打字时 ChatView 每键都重渲染，
  // 内联箭头会让 MessageList 的 memo 失效，整列消息跟着每个字符走一遍。
  const handleQuickPhrase = useCallback((text: string) => setDraft(text), []);
  const handleOpenLeft = useCallback(() => openDrawer("left"), [openDrawer]);
  const handleOpenSettings = useCallback(() => openDrawer("settings"), [openDrawer]);
  const handleNewSession = useCallback(() => void newSession(), [newSession]);
  const handleToggleImage = useCallback(
    () => void setImageEnabled(!imageEnabled),
    [imageEnabled, setImageEnabled],
  );

  const character = characters.find((c) => c.id === activeCharacterId) ?? null;
  const session = sessions.find((s) => s.id === activeSessionId) ?? null;

  useEffect(() => {
    setDraft("");
  }, [activeSessionId]);

  if (!character) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-2 text-2xl shadow-card">
          🎭
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">还没有角色卡</h2>
          <p className="mt-1 text-[13px] text-fg-muted">创建第一个角色，开始你的故事。</p>
        </div>
        <Button variant="primary" onClick={createCharacter} leading={<Sparkles size={15} />}>
          创建角色
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        character={character}
        session={session}
        imageEnabled={imageEnabled}
        onToggleImage={handleToggleImage}
        onOpenLeft={handleOpenLeft}
        onOpenSettings={handleOpenSettings}
        onNewSession={handleNewSession}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessageList
          character={character}
          bottomInset={composerHeight}
          onQuickPhrase={handleQuickPhrase}
        />
        <Composer
          character={character}
          value={draft}
          onChange={setDraft}
          streaming={streaming}
          onHeightChange={handleComposerHeight}
          onSend={() => {
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            void send(text);
          }}
          onStop={stop}
        />
      </div>
    </div>
  );
}
