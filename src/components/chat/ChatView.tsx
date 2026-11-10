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
  const stream = useStore((s) => s.stream);
  const openDrawer = useStore((s) => s.openDrawer);
  const newSession = useStore((s) => s.newSession);
  const createCharacter = useStore((s) => s.createCharacter);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);

  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState(140);
  const handleComposerHeight = useCallback((height: number) => setComposerHeight(height), []);

  const character = characters.find((c) => c.id === activeCharacterId) ?? null;
  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const streaming = stream.running && stream.sessionId === activeSessionId;

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
        onOpenLeft={() => openDrawer("left")}
        onOpenSettings={() => openDrawer("settings")}
        onNewSession={() => void newSession()}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessageList
          character={character}
          bottomInset={composerHeight}
          onQuickPhrase={(text) => setDraft(text)}
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
