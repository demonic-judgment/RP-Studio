import { create } from "zustand";
import type {
  AppSettings,
  Character,
  CharacterDraft,
  DrawerId,
  Message,
  MessageVariant,
  ModelConfig,
  ModelProfile,
  Session,
} from "./types";
import * as repo from "./repo";
import { assembleContext, interpolate } from "./context";
import { chatCompletion } from "./llm";
import { runScript } from "./script";
import { runWorkflow, type WorkflowRunEvent } from "./workflow";
import { DEFAULT_SETTINGS, normalizeSettings, paramModel, resolveModelConfig } from "./settings";
import { initDb } from "./db";
import { applyTheme } from "./theme";
import { nowIso, uid } from "./utils";
import { SEED_CHARACTERS } from "../data/seed";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: "default" | "success" | "error";
}

export interface StreamState {
  running: boolean;
  sessionId: string | null;
  buffer: string;
  logs: { nodeTitle: string; message: string; level: string }[];
  startedAt: number | null;
  mode: "chat" | "workflow";
}

interface Store {
  ready: boolean;
  initError: string | null;
  characters: Character[];
  sessions: Session[];
  messages: Message[];
  settings: AppSettings;
  activeCharacterId: string | null;
  activeSessionId: string | null;
  drawer: DrawerId;
  workflowOpen: boolean;
  stream: StreamState;
  toasts: Toast[];
  busy: boolean;

  init: () => Promise<void>;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** 按 id 覆盖保存（不存在则追加） */
  saveModel: (profile: ModelProfile) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  setActiveModel: (id: string) => Promise<void>;
  openDrawer: (id: DrawerId) => void;
  setWorkflowOpen: (open: boolean) => void;

  selectCharacter: (id: string) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: (characterId?: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  removeSession: (id: string) => Promise<void>;

  createCharacter: () => Promise<void>;
  saveCharacter: (draft: Partial<CharacterDraft> & { id: string }) => Promise<void>;
  removeCharacter: (id: string) => Promise<void>;

  send: (text: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  /** 在同一条消息的历史版本之间切换（0 为最早一版） */
  switchVariant: (messageId: string, index: number) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeMessage: (messageId: string) => Promise<void>;
  stop: () => void;

  exportData: () => Promise<repo.BackupFile>;
  importData: (data: repo.BackupFile) => Promise<void>;
  clearAll: () => Promise<void>;

  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  refreshStats: () => Promise<{ characters: number; sessions: number; messages: number }>;
}

let abortController: AbortController | null = null;
let initStarted = false;

const emptyStream: StreamState = {
  running: false,
  sessionId: null,
  buffer: "",
  logs: [],
  startedAt: null,
  mode: "chat",
};

const LAST_CHAR_KEY = "rp.lastCharacter";

/**
 * 新建会话；角色卡配置了「初始消息」时，把开场白作为角色的第一条消息写入。
 * 这样开场白会进入历史，可被历史切片块取到，也能像普通消息一样复制 / 编辑 / 删除。
 */
async function createSessionFor(character: Character, userName: string) {
  const session = await repo.createSession(character.id, "新会话");
  const greeting = character.greeting?.trim();
  if (greeting) {
    await repo.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: interpolate(greeting, { char: character.name, user: userName }),
      meta: { greeting: true },
    });
  }
  return session;
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  initError: null,
  characters: [],
  sessions: [],
  messages: [],
  settings: DEFAULT_SETTINGS,
  activeCharacterId: null,
  activeSessionId: null,
  drawer: null,
  workflowOpen: false,
  stream: emptyStream,
  toasts: [],
  busy: false,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    try {
      await initDb();
      // 尽量申请持久化存储，降低浏览器清理 IndexedDB 的概率
      void navigator.storage?.persist?.();
      const saved = (await repo.loadSettings()) as { app?: Partial<AppSettings> };
      const settings: AppSettings = normalizeSettings(saved.app ?? {});

      let characters = await repo.listCharacters();
      if (characters.length === 0) {
        for (const seed of SEED_CHARACTERS) {
          await repo.createCharacter(seed);
        }
        characters = await repo.listCharacters();
      }

      const lastId = localStorage.getItem(LAST_CHAR_KEY);
      const active = characters.find((c) => c.id === lastId) ?? characters[0] ?? null;

      set({ settings, characters, ready: true });
      applyTheme(settings.theme, settings.accent);

      if (active) {
        await get().selectCharacter(active.id);
      }
    } catch (err) {
      set({
        ready: true,
        initError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applyTheme(settings.theme, settings.accent);
    await repo.saveSetting("app", settings);
  },

  saveModel: async (profile) => {
    const settings = get().settings;
    const exists = settings.models.some((m) => m.id === profile.id);
    const models = exists
      ? settings.models.map((m) => (m.id === profile.id ? { ...profile } : m))
      : [...settings.models, { ...profile }];
    await get().setSettings({
      models,
      activeModelId: models.some((m) => m.id === settings.activeModelId)
        ? settings.activeModelId
        : profile.id,
    });
  },

  removeModel: async (id) => {
    const settings = get().settings;
    if (settings.models.length <= 1) return;
    const models = settings.models.filter((m) => m.id !== id);
    await get().setSettings({
      models,
      activeModelId: settings.activeModelId === id ? models[0].id : settings.activeModelId,
    });
  },

  setActiveModel: async (id) => {
    const settings = get().settings;
    if (!settings.models.some((m) => m.id === id)) return;
    await get().setSettings({ activeModelId: id });
  },

  openDrawer: (id) => set({ drawer: id }),
  setWorkflowOpen: (open) => set({ workflowOpen: open }),

  selectCharacter: async (id) => {
    const character = get().characters.find((c) => c.id === id) ?? null;
    if (!character) return;
    localStorage.setItem(LAST_CHAR_KEY, id);
    set({ activeCharacterId: id, activeSessionId: null, messages: [] });

    let sessions = await repo.listSessions(id);
    if (sessions.length === 0) {
      await createSessionFor(character, get().settings.userName);
      sessions = await repo.listSessions(id);
    }
    set({ sessions });
    if (sessions[0]) {
      await get().selectSession(sessions[0].id);
    }
  },

  selectSession: async (id) => {
    set({ activeSessionId: id });
    const messages = await repo.listMessages(id);
    set({ messages });
  },

  newSession: async (characterId) => {
    const charId = characterId ?? get().activeCharacterId;
    if (!charId) return;
    const character = get().characters.find((c) => c.id === charId);
    if (!character) return;
    const session = await createSessionFor(character, get().settings.userName);
    set({
      sessions: await repo.listSessions(charId),
      activeSessionId: session.id,
      messages: await repo.listMessages(session.id),
      drawer: null,
    });
  },

  renameSession: async (id, title) => {
    await repo.updateSession(id, { title: title.trim() || "未命名会话" });
    const activeCharacterId = get().activeCharacterId;
    if (activeCharacterId) set({ sessions: await repo.listSessions(activeCharacterId) });
  },

  pinSession: async (id, pinned) => {
    await repo.updateSession(id, { pinned });
    const activeCharacterId = get().activeCharacterId;
    if (activeCharacterId) set({ sessions: await repo.listSessions(activeCharacterId) });
  },

  removeSession: async (id) => {
    await repo.deleteSession(id);
    const characterId = get().activeCharacterId;
    if (!characterId) return;
    const character = get().characters.find((c) => c.id === characterId);
    const before = await repo.listSessions(characterId);
    if (before.length === 0 && character) {
      await createSessionFor(character, get().settings.userName);
    }
    const sessions = await repo.listSessions(characterId);
    set({ sessions });
    if (get().activeSessionId === id && sessions[0]) {
      await get().selectSession(sessions[0].id);
    }
  },

  createCharacter: async () => {
    const character = await repo.createCharacter({ name: "未命名角色", avatar: "🎭" });
    set({ characters: await repo.listCharacters(), activeCharacterId: character.id, drawer: "character" });
    await get().selectCharacter(character.id);
  },

  saveCharacter: async (draft) => {
    const character = await repo.updateCharacter(draft.id, draft);
    const characters = await repo.listCharacters();
    set({ characters });
    if (get().activeCharacterId === character.id) {
      set({ characters: characters.map((c) => (c.id === character.id ? character : c)) });
    }
    get().toast({ title: "角色卡已保存", variant: "success" });
  },

  removeCharacter: async (id) => {
    const wasActive = get().activeCharacterId === id;
    await repo.deleteCharacter(id);
    let characters = await repo.listCharacters();
    if (characters.length === 0) {
      await repo.createCharacter({ name: "未命名角色", avatar: "🎭" });
      characters = await repo.listCharacters();
    }
    // 删的不是当前角色时别动当前会话
    if (!wasActive) {
      set({ characters });
    } else {
      set({ characters, activeCharacterId: null, activeSessionId: null, messages: [], sessions: [] });
      await get().selectCharacter(characters[0].id);
    }
    get().toast({ title: "角色已删除", variant: "default" });
  },

  switchVariant: async (messageId, index) => {
    const message = get().messages.find((m) => m.id === messageId);
    const variants = message?.meta.variants;
    if (!message || !variants || variants.length < 2) return;
    const next = Math.min(Math.max(0, index), variants.length - 1);
    if (next === (message.meta.variantIndex ?? variants.length - 1)) return;

    const content = variants[next].content;
    const status = variants[next].status ?? "done";
    // 切到正常版本时顺手清掉上一条的错误文案，失败版自己带着「请求失败：…」正文
    const meta = { ...message.meta, variantIndex: next, error: undefined };
    await repo.updateMessage(messageId, { content, status, meta });
    set({
      messages: get().messages.map((m) =>
        m.id === messageId ? { ...m, content, status, meta } : m,
      ),
    });
  },

  send: async (text) => {
    const state = get();
    const content = text.trim();
    if (!content || !state.activeCharacterId || state.stream.running) return;

    let sessionId = state.activeSessionId;
    const characterId = state.activeCharacterId;
    if (!sessionId) {
      const character = state.characters.find((c) => c.id === characterId);
      const session = character
        ? await createSessionFor(character, state.settings.userName)
        : await repo.createSession(characterId, "新会话");
      sessionId = session.id;
      set({
        activeSessionId: sessionId,
        sessions: await repo.listSessions(characterId),
        messages: await repo.listMessages(sessionId),
      });
    }

    const userMessage = await repo.appendMessage({ sessionId, role: "user", content });
    const messages = [...get().messages, userMessage];
    set({ messages });

    const session = get().sessions.find((s) => s.id === sessionId);
    if (session && (session.title === "新会话" || !session.title)) {
      const title = content.replace(/\s+/g, " ").slice(0, 22);
      await repo.updateSession(sessionId, { title });
      set({ sessions: await repo.listSessions(characterId) });
    }

    await get().regenerate(userMessage.id);
  },

  regenerate: async (messageId) => {
    const state = get();
    const { activeSessionId, activeCharacterId } = state;
    if (!activeSessionId || !activeCharacterId || state.stream.running) return;
    const character = state.characters.find((c) => c.id === activeCharacterId);
    if (!character) return;

    const messages = await repo.listMessages(activeSessionId);
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    // 生成目标：从这条消息开始重新生成，因此先截断它之后（含自身若是 assistant）的内容
    const target = messages[index];
    let history: Message[];
    let input: string;
    /**
     * 重新生成 assistant 回答时沿用原消息的 id / 时间，并把已有版本带走。
     * 这样新回答是「另一版」而不是「另一条消息」，气泡底下才能来回切。
     */
    let carry: { id: string; createdAt: string; variants: MessageVariant[] } | null = null;

    if (target.role === "user") {
      history = messages.slice(0, index);
      input = target.content;
      const later = messages[index + 1];
      if (later) {
        await repo.truncateAfter(activeSessionId, target.id);
      }
    } else {
      const prevUser = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
      if (!prevUser) return;
      const prevIndex = messages.findIndex((m) => m.id === prevUser.id);
      history = messages.slice(0, prevIndex);
      input = prevUser.content;
      carry = {
        id: target.id,
        createdAt: target.createdAt,
        variants: target.meta.variants?.length
          ? target.meta.variants
          : [{ content: target.content, createdAt: target.createdAt, status: target.status }],
      };
      // 连自身一起删掉，生成完再用同一个 id 写回
      await repo.deleteMessagesFrom(activeSessionId, target.id);
    }

    set({ messages: await repo.listMessages(activeSessionId) });

    const assembled = assembleContext({
      character,
      history,
      input,
      userName: state.settings.userName,
    });

    // 角色前置脚本：可改写装配后的消息栈
    let outbound = assembled.messages;
    if (character.script.trim()) {
      const scripted = await runScript(
        character.script,
        {
          messages: assembled.messages,
          input,
          vars: { char: character.name, user: state.settings.userName, input },
          character,
          history: assembled.messages
            .filter((m) => m.role !== "system")
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n"),
        },
        state.settings.scriptTimeoutMs,
      );
      if (!scripted.ok) {
        get().toast({
          title: "前置脚本执行失败，已忽略",
          description: scripted.error,
          variant: "error",
        });
      } else if (scripted.messages?.length) {
        outbound = scripted.messages;
      }
    }

    const model = resolveModelConfig(state.settings);
    const modelName = paramModel(model.params);
    abortController = new AbortController();
    const startedAt = Date.now();
    const mode: StreamState["mode"] = character.workflow?.enabled ? "workflow" : "chat";

    set({
      stream: {
        running: true,
        sessionId: activeSessionId,
        buffer: "",
        logs: [],
        startedAt,
        mode,
      },
    });

    const finish = async (content: string, status: Message["status"], meta: Message["meta"]) => {
      if (!content && status !== "error") {
        set({ stream: emptyStream });
        return;
      }
      // 重新生成：新回答作为最新一版追加，历史版本原样保留
      const variants = carry
        ? [...carry.variants, { content, createdAt: nowIso(), status }]
        : undefined;
      await repo.appendMessage({
        sessionId: activeSessionId,
        role: "assistant",
        content,
        status,
        id: carry?.id,
        createdAt: carry?.createdAt,
        meta: variants ? { ...meta, variants, variantIndex: variants.length - 1 } : meta,
      });
      set({
        messages: await repo.listMessages(activeSessionId),
        stream: emptyStream,
        sessions: await repo.listSessions(activeCharacterId),
      });
    };

    try {
      if (mode === "workflow") {
        const result = await runWorkflow({
          workflow: character.workflow,
          character,
          initialMessages: outbound,
          input,
          userName: state.settings.userName,
          model,
          signal: abortController.signal,
          scriptTimeoutMs: state.settings.scriptTimeoutMs,
          onEvent: (event: WorkflowRunEvent) => {
            if (event.kind === "delta") {
              set((s) => ({ stream: { ...s.stream, buffer: event.message } }));
            } else if (event.kind === "log" || event.kind === "error") {
              set((s) => ({
                stream: {
                  ...s.stream,
                  logs: [
                    ...s.stream.logs,
                    {
                      nodeTitle: event.nodeTitle ?? event.message,
                      message: event.message,
                      level: event.level ?? "info",
                    },
                  ],
                },
              }));
            }
          },
        });

        if (result.errors.length) {
          get().toast({ title: "工作流有节点失败", description: result.errors[0], variant: "error" });
        } else if (!result.text && !abortController?.signal.aborted) {
          get().toast({
            title: "工作流没有产生输出",
            description: "检查「输出」节点是否连通，或在编排器里试运行排查。",
            variant: "error",
          });
        }
        const aborted = abortController?.signal.aborted;
        await finish(
          result.text,
          aborted ? "stopped" : result.errors.length && !result.text ? "error" : "done",
          {
            model: modelName,
            durationMs: Date.now() - startedAt,
            viaWorkflow: true,
            logs: result.logs.map((l) => `[${l.nodeTitle}] ${l.message}`),
            error: result.errors[0],
          },
        );
      } else {
        const response = await chatCompletion({
          config: model,
          messages: outbound,
          signal: abortController.signal,
          onDelta: (_delta, full) => {
            set((s) => ({ stream: { ...s.stream, buffer: full } }));
          },
        });
        await finish(response.content, response.aborted ? "stopped" : "done", {
          model: modelName,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abortController?.signal.aborted) {
        const partial = get().stream.buffer;
        await finish(partial, "stopped", { model: modelName, durationMs: Date.now() - startedAt });
      } else {
        await finish(`请求失败：${message}`, "error", {
          model: modelName,
          durationMs: Date.now() - startedAt,
          error: message,
        });
        get().toast({ title: "生成失败", description: message, variant: "error" });
      }
    } finally {
      abortController = null;
      set((s) => (s.stream.running ? { stream: emptyStream } : {}));
    }
  },

  editMessage: async (messageId, content) => {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    await repo.updateMessage(messageId, { content, meta: { edited: true } });
    await repo.truncateAfter(sessionId, messageId);
    set({ messages: await repo.listMessages(sessionId) });
    await get().regenerate(messageId);
  },

  removeMessage: async (messageId) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await repo.deleteMessage(messageId);
    set({ messages: await repo.listMessages(sessionId) });
  },

  stop: () => {
    abortController?.abort();
    set((s) => ({ stream: { ...s.stream, running: false } }));
  },

  exportData: () => repo.exportAll(),

  importData: async (data) => {
    await repo.importAll(data);
    const characters = await repo.listCharacters();
    set({ characters, sessions: [], messages: [], activeCharacterId: null, activeSessionId: null });
    const saved = (await repo.loadSettings()) as { app?: Partial<AppSettings> };
    if (saved.app) {
      const settings: AppSettings = normalizeSettings(saved.app);
      set({ settings });
      applyTheme(settings.theme, settings.accent);
    }
    if (characters[0]) await get().selectCharacter(characters[0].id);
    get().toast({ title: "数据已导入", variant: "success" });
  },

  clearAll: async () => {
    await repo.clearAllData();
    for (const seed of SEED_CHARACTERS) {
      await repo.createCharacter(seed);
    }
    const characters = await repo.listCharacters();
    set({ characters, sessions: [], messages: [], activeCharacterId: null, activeSessionId: null });
    if (characters[0]) await get().selectCharacter(characters[0].id);
    get().toast({ title: "所有数据已重置", variant: "default" });
  },

  toast: (t) => {
    const id = uid("toast");
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), 3600);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refreshStats: () => repo.dbStats(),
}));

export function activeCharacter(): Character | null {
  const { characters, activeCharacterId } = useStore.getState();
  return characters.find((c) => c.id === activeCharacterId) ?? null;
}

export function currentModel(): ModelConfig {
  return resolveModelConfig(useStore.getState().settings);
}

export const streamingMessageId = "streaming-placeholder";
export const isStreaming = (s: StreamState, sessionId: string | null) =>
  s.running && sessionId != null && s.sessionId === sessionId;
export const nowString = nowIso;
