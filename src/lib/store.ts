import { create } from "zustand";
import type {
  AppSettings,
  Character,
  CharacterDraft,
  DrawerId,
  ImageProfile,
  ImageRunState,
  ImageWidgetGeometry,
  Message,
  MessageImage,
  MessageMeta,
  MessageVariant,
  ModelConfig,
  ModelProfile,
  Session,
} from "./types";
import * as repo from "./repo";
import { assembleContext, ensureImageDirectiveBlock, interpolate, upgradeImageDirective } from "./context";
import { chatCompletion } from "./llm";
import { runScript } from "./script";
import { runWorkflow, type WorkflowRunEvent } from "./workflow";
import {
  DEFAULT_SETTINGS,
  activeImageProfile,
  normalizeSettings,
  paramModel,
  resolveModelConfig,
} from "./settings";
import { assembleImagePrompt, extractImagePrompt } from "./image-prompt";
import { requestImage, storeImageLocally } from "./image-gen";
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
  /** 当前会话的全部生成图，按 createdAt 升序；同一 messageId 下就是「第二维」 */
  images: MessageImage[];
  /** 画面组件正在看哪一张：messageId 是第一维，imageId 是第二维里的某一版 */
  imageView: { messageId: string; imageId: string } | null;
  /** 生图运行态，和聊天的 stream 分开 —— 画图时聊天照常能发 */
  imageRun: ImageRunState;
  settings: AppSettings;
  activeCharacterId: string | null;
  activeSessionId: string | null;
  drawer: DrawerId;
  workflowOpen: boolean;
  stream: StreamState;
  toasts: Toast[];
  busy: boolean;

  init: () => Promise<void>;
  /**
   * `persist: false` 只改内存，用于拖拽滑杆这类高频更新 ——
   * 背景图是几百 KB 的 data URL，每动一格就整行写 jsonb 会把拖动卡成幻灯片。
   */
  setSettings: (patch: Partial<AppSettings>, options?: { persist?: boolean }) => Promise<void>;
  /** 按 id 覆盖保存（不存在则追加） */
  saveModel: (profile: ModelProfile) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  setActiveModel: (id: string) => Promise<void>;
  /** 图生图总开关：关掉即停止解析 / 生图 / 悬浮画面 */
  setImageEnabled: (enabled: boolean) => Promise<void>;
  saveImageModel: (profile: ImageProfile) => Promise<void>;
  removeImageModel: (id: string) => Promise<void>;
  setActiveImageModel: (id: string) => Promise<void>;
  /**
   * 画一张。`messageId` 决定绑到哪条气泡（缺省跟随当前查看的那组）；
   * 同一组再画一次是追加版本，旧图不删。
   */
  generateImage: (opts?: { messageId?: string; prompt?: string; baseImageId?: string }) => Promise<void>;
  focusImage: (messageId: string, imageId: string) => void;
  removeImage: (id: string) => Promise<void>;
  /** 悬浮画面组件的位置 / 尺寸，拖动时用 persist:false，松手再落库 */
  setImageWidget: (geometry: ImageWidgetGeometry, options?: { persist?: boolean }) => Promise<void>;
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
  /** 以这条消息为终点，把当前会话复制成一个新会话，之后在这里继续聊 */
  branchConversation: (messageId: string) => Promise<void>;
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

/**
 * 给还没有「生图 JSON 预设」的角色补一条（老数据 / 导入的备份）。
 * 只在图生图开启时调用：关着的时候补进去也看不到，没必要写库。
 */
async function withImageDirective(characters: Character[]): Promise<Character[] | null> {
  const next: Character[] = [];
  let changed = false;
  for (const character of characters) {
    const blocks = character.contextBlocks ?? [];
    const hasBlock = blocks.some((block) => block.kind === "image");
    // 已有预设的角色：只把老文案里的 1:1 换成 2:3，用户自己改过的内容不动
    const contextBlocks = hasBlock
      ? blocks.map((block) => {
          if (block.kind !== "image") return block;
          const content = upgradeImageDirective(block.content);
          return content === block.content ? block : { ...block, content };
        })
      : ensureImageDirectiveBlock(blocks);
    if (contextBlocks.every((block, index) => block === blocks[index])) {
      next.push(character);
      continue;
    }
    next.push(await repo.updateCharacter(character.id, { contextBlocks }));
    changed = true;
  }
  return changed ? next : null;
}

/**
 * 一次性清洗老数据：早先只把生图 JSON 从渲染里藏起来，正文里还留着整段 JSON，
 * 于是每轮装配上下文都会把它重新喂给模型（费 token，还教模型复读模板）。
 * 只处理「确实解析出提示词」的消息，且只捞带 `{` 的行，成本很小。
 */
async function stripLegacyImageJson(): Promise<void> {
  const suspects = await repo.listJsonSuspectMessages();
  for (const message of suspects) {
    if (message.role !== "assistant") continue;
    const extracted = extractImagePrompt(message.content);
    if (!extracted.prompt) continue;

    let meta: MessageMeta = { ...message.meta, imagePrompt: message.meta.imagePrompt || extracted.prompt };
    if (meta.variants?.length) {
      meta = {
        ...meta,
        variants: meta.variants.map((variant) => {
          if (!variant.content.includes("{")) return variant;
          const each = extractImagePrompt(variant.content);
          if (!each.prompt) return variant;
          return {
            ...variant,
            content: each.text,
            imagePrompt: variant.imagePrompt || each.prompt,
          };
        }),
      };
    }
    await repo.updateMessage(message.id, { content: extracted.text, meta });
  }
}

const emptyStream: StreamState = {
  running: false,
  sessionId: null,
  buffer: "",
  logs: [],
  startedAt: null,
  mode: "chat",
};

const emptyImageRun: ImageRunState = {
  running: false,
  sessionId: null,
  messageId: null,
  startedAt: null,
  error: null,
};

type ImageTask = { messageId?: string; prompt?: string; baseImageId?: string };

/**
 * 画图比聊天慢一个数量级，连着聊几句就会撞上上一次还没画完。
 * 这里排队而不是丢弃：同时起几张图会把接口打到限流，画面也会一起跳。
 */
const imageQueue: ImageTask[] = [];
const IMAGE_QUEUE_LIMIT = 4;

function clearImageQueue() {
  imageQueue.length = 0;
}

function drainImageQueue() {
  const next = imageQueue.shift();
  if (!next) return;
  // 等这一轮状态落定再起下一张，否则会读到上一张的 running
  setTimeout(() => void useStore.getState().generateImage(next), 0);
}

/**
 * 把一维数组折成二维视图：第一维是气泡（messageId），第二维是这组的多次生图。
 * 顺序沿用 createdAt 升序，和数据库里读出来的顺序一致。
 */
export function groupImages(images: MessageImage[]): { messageId: string; images: MessageImage[] }[] {
  const groups: { messageId: string; images: MessageImage[] }[] = [];
  const index = new Map<string, number>();
  for (const image of images) {
    const at = index.get(image.messageId);
    if (at === undefined) {
      index.set(image.messageId, groups.length);
      groups.push({ messageId: image.messageId, images: [image] });
    } else {
      groups[at].images.push(image);
    }
  }
  return groups;
}

/** 从后往前找第一个满足条件的元素：比 `[...list].reverse().find()` 少一次整数组复制 */
function lastMatch<T>(list: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (test(list[i])) return list[i];
  }
  return undefined;
}

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

/**
 * 分支会话的标题：从原会话标题派生，不再叠加「分支 · 分支 ·」，
 * 太长时截断 —— 抽屉里本来就一行放不下。
 */
function branchTitle(title?: string) {
  const base = (title ?? "").trim().replace(/^分支 · /, "") || "新会话";
  const text = `分支 · ${base}`;
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  initError: null,
  characters: [],
  sessions: [],
  messages: [],
  images: [],
  imageView: null,
  imageRun: emptyImageRun,
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
      // 两组查询互不依赖，一起发：启动时 PGlite 每次往返都要等一轮
      const [saved, initialCharacters] = await Promise.all([
        repo.loadSettings() as Promise<{ app?: Partial<AppSettings> }>,
        repo.listCharacters(),
      ]);
      const settings: AppSettings = normalizeSettings(saved.app ?? {});

      let characters = initialCharacters;
      if (characters.length === 0) {
        for (const seed of SEED_CHARACTERS) {
          await repo.createCharacter(seed);
        }
        characters = await repo.listCharacters();
      }
      // 上次就开着图生图：把缺预设的老角色一并补齐
      if (settings.imageEnabled) {
        characters = (await withImageDirective(characters)) ?? characters;
      }
      // 老消息正文里的生图 JSON 清一次（失败不影响启动，下次还会再试）
      await stripLegacyImageJson().catch(() => undefined);

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

  setSettings: async (patch, options) => {
    const prev = get().settings;
    const settings = { ...prev, ...patch };
    set({ settings });
    // 只有主题 / 强调色真的变了才重刷 CSS 变量：
    // 在设置里打一个字也走这里，整页样式失效一次不划算
    if (settings.theme !== prev.theme || settings.accent !== prev.accent) {
      applyTheme(settings.theme, settings.accent);
    }
    if (options?.persist === false) return;
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

  setImageEnabled: async (enabled) => {
    await get().setSettings({ imageEnabled: enabled });
    if (enabled) {
      // 老角色卡里没有这条预设：打开开关时补进角色数据，
      // 角色卡的「提示词编排」里就能直接看到并修改，而不是只靠装配时兜底。
      const characters = await withImageDirective(get().characters);
      if (characters) set({ characters });
    } else {
      // 关掉开关时把上一次的失败提示一起清掉，别留着红字挂在空组件上
      clearImageQueue();
      set({ imageRun: emptyImageRun });
    }
  },

  saveImageModel: async (profile) => {
    const settings = get().settings;
    const exists = settings.imageModels.some((m) => m.id === profile.id);
    const imageModels = exists
      ? settings.imageModels.map((m) => (m.id === profile.id ? { ...profile } : m))
      : [...settings.imageModels, { ...profile }];
    await get().setSettings({
      imageModels,
      activeImageModelId: imageModels.some((m) => m.id === settings.activeImageModelId)
        ? settings.activeImageModelId
        : profile.id,
    });
  },

  removeImageModel: async (id) => {
    const settings = get().settings;
    if (settings.imageModels.length <= 1) return;
    const imageModels = settings.imageModels.filter((m) => m.id !== id);
    await get().setSettings({
      imageModels,
      activeImageModelId:
        settings.activeImageModelId === id ? imageModels[0].id : settings.activeImageModelId,
    });
  },

  setActiveImageModel: async (id) => {
    const settings = get().settings;
    if (!settings.imageModels.some((m) => m.id === id)) return;
    await get().setSettings({ activeImageModelId: id });
  },

  setImageWidget: async (geometry, options) => {
    await get().setSettings({ imageWidget: geometry }, options);
  },

  focusImage: (messageId, imageId) => {
    if (!get().images.some((img) => img.id === imageId)) return;
    set({ imageView: { messageId, imageId } });
  },

  removeImage: async (id) => {
    await repo.deleteImage(id);
    const state = get();
    const images = state.images.filter((img) => img.id !== id);
    const view = state.imageView;
    if (view && view.imageId === id) {
      const group = groupImages(images).find((g) => g.messageId === view.messageId);
      const next = group?.images[group.images.length - 1] ?? images[images.length - 1];
      set({
        images,
        imageView: next ? { messageId: next.messageId, imageId: next.id } : null,
      });
      return;
    }
    set({ images });
  },

  generateImage: async (opts) => {
    const state = get();
    const startedAt = performance.now();
    const { activeSessionId, activeCharacterId, settings } = state;
    if (!activeSessionId || !activeCharacterId) {
      drainImageQueue();
      return;
    }
    // 排队而不是丢弃：等这一张画完接着画下一张，底图链才不会错位
    if (state.imageRun.running) {
      if (imageQueue.length < IMAGE_QUEUE_LIMIT) imageQueue.push(opts ?? {});
      return;
    }
    const character = state.characters.find((c) => c.id === activeCharacterId);
    if (!character) {
      drainImageQueue();
      return;
    }

    const images = state.images;
    // 第一维：这一张画给哪条气泡。显式指定 > 正在看的那组 > 最新一张图 > 最后一条角色回复
    // （不再为了拿「最新一组」把全部图片分组：这一步每轮生图前都要跑）
    const messageId =
      opts?.messageId ||
      state.imageView?.messageId ||
      images[images.length - 1]?.messageId ||
      lastMatch(state.messages, (m) => m.role === "assistant")?.id ||
      "";
    if (!messageId) {
      get().toast({
        title: "还没有可以绑定的回复",
        description: "先聊一句：画面会跟着角色的每条回复变化",
        variant: "default",
      });
      drainImageQueue();
      return;
    }

    // 提示词：显式传入 > 这一组最后一张的原文 > 会话里最新一张 > 最后一条角色回复的 meta
    const group = images.filter((img) => img.messageId === messageId);
    const rawPrompt =
      opts?.prompt?.trim() ||
      lastMatch(group, (img) => Boolean(img.rawPrompt.trim()))?.rawPrompt ||
      lastMatch(images, (img) => Boolean(img.rawPrompt.trim()))?.rawPrompt ||
      lastMatch(state.messages, (m) => m.role === "assistant" && Boolean(m.meta.imagePrompt))?.meta
        .imagePrompt ||
      "";
    if (!rawPrompt) {
      get().toast({
        title: "没有可用的生图提示词",
        description: "等回复里带上「生图提示词」，或换用配好该模板的角色卡",
        variant: "error",
      });
      drainImageQueue();
      return;
    }

    /**
     * 底图不随对话滚动：所有图都以角色卡的**三视图底图**为参考重新画，画面变化只来自提示词。
     * 之前是「上一张 → 下一张」的链式演化，问题在于每轮都会继承上一张的构图与画风偏差，
     * 于是同一角色越画越偏、还回不去；固定三视图后每个气泡都是同一张脸 + 不同的那一幕，
     * 重新生图的多个版本也因此天然处在同一起点。
     * 三张（正 / 侧 / 背）一起上传，模型能从多个角度对齐发型、服装与体型。
     * `opts.baseImageId` 只作为显式覆盖保留（目前没有 UI 入口）。
     */
    const baseRecord = opts?.baseImageId ? images.find((img) => img.id === opts.baseImageId) : undefined;
    const baseImages = baseRecord ? [baseRecord.url] : character.imageSeeds.filter((src) => Boolean(src));

    const profile = activeImageProfile(settings);
    if (profile.mode === "edit" && baseImages.length === 0) {
      get().toast({
        title: "图生图缺少底图",
        description: "在角色卡基础页上传三视图参考图（至少一张），或把生图档案切成文生图",
        variant: "error",
      });
      drainImageQueue();
      return;
    }

    const assembled = assembleImagePrompt({
      blocks: settings.imagePromptBlocks,
      characterName: character.name,
      userName: settings.userName,
      prompt: rawPrompt,
    });

    set({
      imageRun: {
        running: true,
        sessionId: activeSessionId,
        messageId,
        startedAt: Date.now(),
        error: null,
      },
    });

    try {
      if (import.meta.env.DEV) {
        // 组装阶段（解析提示词 → 拼装 → 取底图）应该是个位数毫秒；
        // 明显变大说明又有人在请求前加了同步活或者 await
        console.debug(`[生图] 组装完成 ${Math.round(performance.now() - startedAt)}ms`);
      }
      const result = await requestImage({
        config: profile,
        prompt: assembled.text,
        baseImages,
      });
      const stored = await storeImageLocally(result.url);
      const saved = await repo.appendImage({
        sessionId: activeSessionId,
        characterId: activeCharacterId,
        messageId,
        prompt: assembled.text,
        rawPrompt,
        baseImageId: baseRecord?.id ?? null,
        url: stored,
        model: result.model || profile.name,
      });
      // 中途切了会话：图照样落库，但别并进另一个会话的内存列表
      if (get().activeSessionId === activeSessionId) {
        set((s) => ({
          images: [...s.images, saved],
          imageView: { messageId, imageId: saved.id },
          imageRun: emptyImageRun,
        }));
      } else {
        set({ imageRun: emptyImageRun });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ imageRun: { ...emptyImageRun, error: message } });
      get().toast({ title: "生图失败", description: message, variant: "error" });
    }
    drainImageQueue();
  },

  openDrawer: (id) => set({ drawer: id }),
  setWorkflowOpen: (open) => set({ workflowOpen: open }),

  selectCharacter: async (id) => {
    const character = get().characters.find((c) => c.id === id) ?? null;
    if (!character) return;
    localStorage.setItem(LAST_CHAR_KEY, id);
    clearImageQueue();
    set({
      activeCharacterId: id,
      activeSessionId: null,
      messages: [],
      images: [],
      imageView: null,
      imageRun: emptyImageRun,
    });

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
    // 换会话就丢掉排队中的生图：它们绑的是上一个会话的气泡
    clearImageQueue();
    const [messages, images] = await Promise.all([repo.listMessages(id), repo.listImages(id)]);
    const last = images[images.length - 1];
    set({
      messages,
      images,
      imageView: last ? { messageId: last.messageId, imageId: last.id } : null,
      imageRun: emptyImageRun,
    });
  },

  newSession: async (characterId) => {
    const charId = characterId ?? get().activeCharacterId;
    if (!charId) return;
    const character = get().characters.find((c) => c.id === charId);
    if (!character) return;
    const session = await createSessionFor(character, get().settings.userName);
    clearImageQueue();
    set({
      sessions: await repo.listSessions(charId),
      activeSessionId: session.id,
      messages: await repo.listMessages(session.id),
      images: [],
      imageView: null,
      imageRun: emptyImageRun,
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
      set({
        characters,
        activeCharacterId: null,
        activeSessionId: null,
        messages: [],
        sessions: [],
        images: [],
        imageView: null,
        imageRun: emptyImageRun,
      });
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
    // 切到正常版本时顺手清掉上一条的错误文案，失败版自己带着「请求失败：…」正文；
    // 生图提示词跟着版本一起切，否则画面会一直对着上一次的文案画
    const meta = {
      ...message.meta,
      variantIndex: next,
      error: undefined,
      imagePrompt: variants[next].imagePrompt,
    };
    await repo.updateMessage(messageId, { content, status, meta });
    set({
      messages: get().messages.map((m) =>
        m.id === messageId ? { ...m, content, status, meta } : m,
      ),
    });
  },

  branchConversation: async (messageId) => {
    const state = get();
    const { activeSessionId, activeCharacterId } = state;
    if (!activeSessionId || !activeCharacterId || state.stream.running) return;

    const all = await repo.listMessages(activeSessionId);
    const index = all.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    const source = state.sessions.find((s) => s.id === activeSessionId);
    const session = await repo.branchSession({
      characterId: activeCharacterId,
      title: branchTitle(source?.title),
      // 只带走到这条消息为止的部分：后面的内容留在原会话里
      messages: all.slice(0, index + 1),
    });

    set({
      sessions: await repo.listSessions(activeCharacterId),
      activeSessionId: session.id,
      messages: await repo.listMessages(session.id),
      drawer: null,
    });
    get().toast({
      title: "已创建分支对话",
      description: "从这里接着聊，原会话不会受影响",
      variant: "success",
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
      clearImageQueue();
      set({
        activeSessionId: sessionId,
        sessions: await repo.listSessions(characterId),
        messages: await repo.listMessages(sessionId),
        images: [],
        imageView: null,
        imageRun: emptyImageRun,
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

    /**
     * 截断 / 重生成之后的图片对齐：
     * - 被截掉的气泡，它名下的图也从内存里摘掉（库里由 pruneImages 收尾）；
     * - 正在重新生成的那条会沿用原 id 写回，它的图（第二维）先留着，等写回后才算有效。
     */
    const kept = new Set(get().messages.map((m) => m.id));
    if (carry) kept.add(carry.id);
    const keptImages = get().images.filter((img) => kept.has(img.messageId));
    const view = get().imageView;
    const viewStillThere = view ? keptImages.some((img) => img.id === view.imageId) : false;
    const lastImage = keptImages[keptImages.length - 1];
    set({
      images: keptImages,
      imageView: viewStillThere
        ? view
        : lastImage
          ? { messageId: lastImage.messageId, imageId: lastImage.id }
          : null,
    });
    if (!carry) void repo.pruneImages(activeSessionId);

    const assembled = assembleContext({
      character,
      history,
      input,
      userName: state.settings.userName,
      imageEnabled: state.settings.imageEnabled,
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

    /**
     * 流式途中就抓生图 JSON：提示词一旦完整闭合就把图放出去，
     * 不等整条回复写完 —— 模型后半段还要打的字，跟画图并行跑。
     *
     * 代价是图可能比消息行先落库（新回复这一刻还没有 id）：
     * 所以整轮流式先占定一个 id，`finish` 写回时复用它，
     * 早画出来的图挂在这个 id 上，等消息落库后自然对得上。
     */
    const earlyMessageId = carry?.id ?? uid();
    let earlyPrompt = "";
    let probedLength = 0;
    const maybeEarlyGenerate = (full: string) => {
      if (earlyPrompt || !state.settings.imageEnabled) return;
      // 廉价门槛：没有闭合的 `}` / 围栏就说明 JSON 还没打完，别做全量扫描
      if (full.length < 24 || (!full.includes("}") && !full.includes("```"))) return;
      // 每个 chunk 都解析一次太贵：攒够一小段再看
      if (full.length - probedLength < 16) return;
      probedLength = full.length;
      const probed = extractImagePrompt(full);
      if (!probed.prompt) return;
      earlyPrompt = probed.prompt;
      // 不 await：画图在后台跑，正文继续往下流
      void get().generateImage({ messageId: earlyMessageId, prompt: probed.prompt });
    };

    const finish = async (content: string, status: Message["status"], meta: Message["meta"]) => {
      if (!content && status !== "error") {
        set({ stream: emptyStream });
        return;
      }
      /**
       * 生图 JSON 只取一次，正文落库时就把 JSON 摘掉：
       * 提示词进 `meta.imagePrompt` 供画面组件用，`content` 只留台词。
       * 不能只「渲染时隐藏」——那样下一轮装配上下文时整段 JSON 又会喂回模型，
       * 白白占 token，还会让模型学会复读模板。
       */
      const extracted = extractImagePrompt(content);
      const text = status === "error" ? content : extracted.text;
      // 整条回复只有生图 JSON、又抽不出提示词：存下来只是一条空气泡，直接丢掉
      if (!text && !extracted.prompt && status !== "error") {
        set({ stream: emptyStream });
        return;
      }
      const nextMeta: Message["meta"] = extracted.prompt
        ? { ...meta, imagePrompt: extracted.prompt }
        : meta;
      // 重新生成：新回答作为最新一版追加，历史版本原样保留（同样只存摘干净的正文）
      const variants = carry
        ? [
            ...carry.variants,
            { content: text, createdAt: nowIso(), status, imagePrompt: extracted.prompt },
          ]
        : undefined;
      const saved = await repo.appendMessage({
        sessionId: activeSessionId,
        role: "assistant",
        content: text,
        status,
        // 流式途中已经提前生过图的话，消息必须落在那个 id 上，否则图就成了孤儿
        id: carry?.id ?? earlyMessageId,
        createdAt: carry?.createdAt,
        meta: variants ? { ...nextMeta, variants, variantIndex: variants.length - 1 } : nextMeta,
      });
      // 直接把写入结果并进内存，不再整表重读一遍：
      // 长会话里每次回复都 select 全量消息 + 反序列化 meta，纯属白干
      const prev = get().messages;
      const messages = prev.some((m) => m.id === saved.id)
        ? prev.map((m) => (m.id === saved.id ? saved : m))
        : [...prev, saved];
      set({ messages, stream: emptyStream });
      // 先把生图放出去，再刷新会话列表：listSessions 在 PGlite 上要一次查询往返，
      // 挡在生图前面会把「回复结束 → 开始画」的空档硬生生拉长一截。
      // 流式途中已经按同一段提示词开过画的话，这里不再重复下单。
      if (extracted.prompt && extracted.prompt !== earlyPrompt && status !== "error" && get().settings.imageEnabled) {
        // 不 await：图在后台画，聊天不用等
        void get().generateImage({ messageId: saved.id, prompt: extracted.prompt });
      }
      // 重新生成时先删后插，消息行直到这一刻才存在：孤儿图在这里清才安全
      if (carry) void repo.pruneImages(activeSessionId);
      set({ sessions: await repo.listSessions(activeCharacterId) });
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
              maybeEarlyGenerate(event.message);
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
            maybeEarlyGenerate(full);
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
    const target = state.messages.find((m) => m.id === messageId);

    // 角色的回复就地改文案，不重跑模型——改的是已经生成出来的那段话。
    // 当前版本要一起改：meta.variants 里存着正文快照，只改 content 的话，
    // 切到别的版本再切回来，编辑就被旧快照盖掉了。
    if (target?.role === "assistant") {
      // 手改的原文同样要摘掉生图 JSON：否则用户从旧消息里把这行粘回来，
      // 下一轮上下文又把它带上。只在真的抽到提示词时才覆盖，避免把已有提示词冲成空。
      const extracted = extractImagePrompt(content);
      const text = extracted.text;
      const meta: MessageMeta = { ...target.meta, edited: true };
      if (extracted.prompt) meta.imagePrompt = extracted.prompt;
      if (meta.variants?.length) {
        const index = meta.variantIndex ?? meta.variants.length - 1;
        meta.variants = meta.variants.map((variant, i) =>
          i === index ? { ...variant, content: text } : variant,
        );
      }
      await repo.updateMessage(messageId, { content: text, meta });
      // 就地替换这一条，不为一次改名把整段历史重新读一遍
      set({ messages: state.messages.map((m) => (m.id === messageId ? { ...m, content: text, meta } : m)) });
      return;
    }

    await repo.updateMessage(messageId, { content, meta: { edited: true } });
    await repo.truncateAfter(sessionId, messageId);
    set({ messages: await repo.listMessages(sessionId) });
    await get().regenerate(messageId);
  },

  removeMessage: async (messageId) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await repo.deleteMessage(messageId);
    // 删掉的气泡，名下的图一起清：否则图库里会留下一堆没有落点的图
    await repo.pruneImages(sessionId);
    const messages = await repo.listMessages(sessionId);
    const images = get().images.filter((img) => messages.some((m) => m.id === img.messageId));
    const view = get().imageView;
    const stillThere = view && images.some((img) => img.id === view.imageId);
    const last = images[images.length - 1];
    set({
      messages,
      images,
      imageView: stillThere ? view : last ? { messageId: last.messageId, imageId: last.id } : null,
    });
  },

  stop: () => {
    abortController?.abort();
    set((s) => ({ stream: { ...s.stream, running: false } }));
  },

  exportData: () => repo.exportAll(),

  importData: async (data) => {
    await repo.importAll(data);
    let characters = await repo.listCharacters();
    // 备份里的老角色没有生图 JSON 预设，开着图生图就补上
    if (get().settings.imageEnabled) {
      characters = (await withImageDirective(characters)) ?? characters;
    }
    // 备份里的正文可能还带着生图 JSON，导入后就地清一遍
    await stripLegacyImageJson().catch(() => undefined);
    set({
      characters,
      sessions: [],
      messages: [],
      images: [],
      imageView: null,
      imageRun: emptyImageRun,
      activeCharacterId: null,
      activeSessionId: null,
    });
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
    set({
      characters,
      sessions: [],
      messages: [],
      images: [],
      imageView: null,
      imageRun: emptyImageRun,
      activeCharacterId: null,
      activeSessionId: null,
    });
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
