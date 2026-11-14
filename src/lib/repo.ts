import { getDb } from "./db";
import type {
  Character,
  CharacterDraft,
  Message,
  MessageImage,
  MessageMeta,
  QuickPhrase,
  Session,
  Space,
  SpaceDraft,
  Workflow,
} from "./types";
import { nowIso, uid } from "./utils";
import { defaultContextBlocks, ensureCharacterBlock, normalizeContextBlocks } from "./context";

/* ------------------------------- row mapping ------------------------------ */

type SpaceRow = {
  id: string;
  name: string;
  avatar: string;
  image_seed: string | null;
  image_seeds: unknown;
  system_prompt: string;
  context_blocks: unknown;
  quick_phrases: unknown;
  workflow: unknown;
  script: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type CharacterRow = {
  id: string;
  space_id: string;
  name: string;
  avatar: string;
  greeting: string;
  system_prompt: string;
  active_seed: string;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type SessionRow = {
  id: string;
  space_id: string;
  character_id: string;
  title: string;
  pinned: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  message_count?: number | string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  status: Message["status"];
  meta: unknown;
  created_at: string | Date;
};

type ImageRow = {
  id: string;
  session_id: string;
  character_id: string;
  message_id: string | null;
  prompt: string;
  raw_prompt: string;
  base_image_id: string | null;
  url: string;
  model: string;
  status: string;
  error: string;
  created_at: string | Date;
};

const iso = (v: string | Date | null | undefined): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : nowIso();

const asObject = <T>(v: unknown, fallback: T): T =>
  v && typeof v === "object" ? (v as T) : fallback;

/**
 * 空间底图库：`image_seeds` 存全部上传过的图，`image_seed`（老单值列）只在
 * 迁移前的数据里出现，读的时候当兜底。空槽用 `""` 占位，调用方自己过滤。
 */
function asImageSeeds(value: unknown, legacy: string | null | undefined): string[] {
  const slots = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  if (slots.some(Boolean)) return slots;
  return legacy ? [legacy] : [];
}

function mapSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    systemPrompt: row.system_prompt,
    imageSeeds: asImageSeeds(row.image_seeds, row.image_seed),
    // 原样返回：用户可能故意删掉「角色专属提示」块，读的时候不要偷偷补回去。
    // 但脏数据要在这里过滤掉（解包早期聚合写法留下的 {elem, ord}），否则界面渲染会崩
    contextBlocks: normalizeContextBlocks(row.context_blocks),
    quickPhrases: asObject<QuickPhrase[]>(row.quick_phrases, []),
    workflow: asObject<Workflow>(row.workflow, { enabled: false, nodes: [], edges: [] }),
    script: row.script ?? "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    avatar: row.avatar,
    greeting: row.greeting ?? "",
    systemPrompt: row.system_prompt ?? "",
    activeSeed: row.active_seed ?? "",
    sortOrder: row.sort_order ?? 0,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    spaceId: row.space_id,
    characterId: row.character_id,
    title: row.title,
    pinned: row.pinned,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    messageCount: row.message_count != null ? Number(row.message_count) : undefined,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    status: row.status,
    meta: asObject<MessageMeta>(row.meta, {}),
    createdAt: iso(row.created_at),
  };
}

function mapImage(row: ImageRow): MessageImage {
  return {
    id: row.id,
    sessionId: row.session_id,
    characterId: row.character_id,
    messageId: row.message_id ?? "",
    prompt: row.prompt ?? "",
    rawPrompt: row.raw_prompt ?? "",
    baseImageId: row.base_image_id ?? null,
    url: row.url ?? "",
    model: row.model ?? "",
    status: row.status === "error" ? "error" : "done",
    error: row.error || undefined,
    createdAt: iso(row.created_at),
  };
}

/* ---------------------------------- spaces -------------------------------- */

export async function listSpaces(): Promise<Space[]> {
  // 按创建时间排：保存空间的那一下不该让它在左栏里跳到最上面
  const { rows } = await getDb().query<SpaceRow>("select * from spaces order by created_at asc");
  return rows.map(mapSpace);
}

export async function getSpace(id: string): Promise<Space | null> {
  const { rows } = await getDb().query<SpaceRow>("select * from spaces where id = $1", [id]);
  return rows[0] ? mapSpace(rows[0]) : null;
}

/**
 * 新建空间：同一事务里补第一个角色（可用 `firstCharacter` 指定名字与开场白）。
 * 空间不能没有角色 —— 没有角色就没有会话，左栏会是一个点不动的空壳。
 */
export async function createSpace(
  draft: SpaceDraft = {},
  firstCharacter: CharacterDraft = {},
): Promise<{ space: Space; character: Character }> {
  const db = getDb();
  const spaceId = draft.id ?? uid();
  const ts = nowIso();
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<SpaceRow>(
      `insert into spaces
        (id, name, avatar, image_seed, image_seeds, system_prompt,
         context_blocks, quick_phrases, workflow, script, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$11)
       returning *`,
      [
        spaceId,
        draft.name?.trim() || "新空间",
        draft.avatar || "🎭",
        "",
        JSON.stringify(draft.imageSeeds ?? []),
        draft.systemPrompt || "",
        JSON.stringify(draft.contextBlocks ?? defaultContextBlocks()),
        JSON.stringify(draft.quickPhrases ?? []),
        JSON.stringify(draft.workflow ?? { enabled: false, nodes: [], edges: [] }),
        draft.script ?? "",
        ts,
      ],
    );
    const child = await tx.query<CharacterRow>(
      `insert into characters
        (id, space_id, name, avatar, greeting, system_prompt, active_seed, sort_order, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       returning *`,
      [
        uid(),
        spaceId,
        firstCharacter.name?.trim() || "未命名角色",
        firstCharacter.avatar || "🎭",
        firstCharacter.greeting || "",
        firstCharacter.systemPrompt || "",
        firstCharacter.activeSeed || (draft.imageSeeds ?? []).find((src) => Boolean(src)) || "",
        0,
        ts,
      ],
    );
    return { space: mapSpace(rows[0]), character: mapCharacter(child.rows[0]) };
  });
}

export async function updateSpace(id: string, patch: SpaceDraft): Promise<Space> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.avatar !== undefined) push("avatar", patch.avatar);
  if (patch.systemPrompt !== undefined) push("system_prompt", patch.systemPrompt);
  if (patch.imageSeeds !== undefined) {
    push("image_seeds", JSON.stringify(patch.imageSeeds), "::jsonb");
  }
  if (patch.contextBlocks !== undefined) push("context_blocks", JSON.stringify(patch.contextBlocks), "::jsonb");
  if (patch.quickPhrases !== undefined) push("quick_phrases", JSON.stringify(patch.quickPhrases), "::jsonb");
  if (patch.workflow !== undefined) push("workflow", JSON.stringify(patch.workflow), "::jsonb");
  if (patch.script !== undefined) push("script", patch.script);

  push("updated_at", nowIso());
  values.push(id);
  const { rows } = await getDb().query<SpaceRow>(
    `update spaces set ${sets.join(", ")} where id = $${values.length} returning *`,
    values,
  );
  if (!rows[0]) throw new Error("空间不存在");
  return mapSpace(rows[0]);
}

/** 删空间：底下的角色、会话、消息、图片都由外键级联清掉 */
export async function deleteSpace(id: string): Promise<void> {
  await getDb().query("delete from spaces where id = $1", [id]);
}

/* -------------------------------- characters ------------------------------ */

export async function listCharacters(spaceId?: string): Promise<Character[]> {
  const db = getDb();
  if (spaceId) {
    const { rows } = await db.query<CharacterRow>(
      "select * from characters where space_id = $1 order by sort_order asc, created_at asc",
      [spaceId],
    );
    return rows.map(mapCharacter);
  }
  const { rows } = await db.query<CharacterRow>(
    "select * from characters order by sort_order asc, created_at asc",
  );
  return rows.map(mapCharacter);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const { rows } = await getDb().query<CharacterRow>(
    "select * from characters where id = $1",
    [id],
  );
  return rows[0] ? mapCharacter(rows[0]) : null;
}

export async function createCharacter(
  spaceId: string,
  draft: CharacterDraft = {},
): Promise<Character> {
  const ts = nowIso();
  // 排在同空间最后一个角色后面：新建的角色总在列表末尾，位置稳定
  const { rows: tail } = await getDb().query<{ next: number | string }>(
    "select coalesce(max(sort_order), -1) + 1 as next from characters where space_id = $1",
    [spaceId],
  );
  const order = Number(tail[0]?.next ?? 0);
  const { rows } = await getDb().query<CharacterRow>(
    `insert into characters
      (id, space_id, name, avatar, greeting, system_prompt, active_seed, sort_order, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     returning *`,
    [
      draft.id ?? uid(),
      spaceId,
      draft.name?.trim() || "未命名角色",
      draft.avatar || "🎭",
      draft.greeting || "",
      draft.systemPrompt || "",
      draft.activeSeed || "",
      order,
      ts,
    ],
  );
  return mapCharacter(rows[0]);
}

export async function updateCharacter(id: string, patch: CharacterDraft): Promise<Character> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.avatar !== undefined) push("avatar", patch.avatar);
  if (patch.greeting !== undefined) push("greeting", patch.greeting);
  if (patch.systemPrompt !== undefined) push("system_prompt", patch.systemPrompt);
  if (patch.activeSeed !== undefined) push("active_seed", patch.activeSeed);
  if (patch.sortOrder !== undefined) push("sort_order", patch.sortOrder);

  push("updated_at", nowIso());
  values.push(id);
  const { rows } = await getDb().query<CharacterRow>(
    `update characters set ${sets.join(", ")} where id = $${values.length} returning *`,
    values,
  );
  if (!rows[0]) throw new Error("角色不存在");
  return mapCharacter(rows[0]);
}

export async function deleteCharacter(id: string): Promise<void> {
  await getDb().query("delete from characters where id = $1", [id]);
}

export async function countCharacters(spaceId: string): Promise<number> {
  const { rows } = await getDb().query<{ n: number | string }>(
    "select count(*) as n from characters where space_id = $1",
    [spaceId],
  );
  return Number(rows[0]?.n ?? 0);
}

/* --------------------------------- sessions ------------------------------- */

/** 会话按角色取：同一空间的不同角色各有自己的一套会话 */
export async function listSessions(characterId?: string): Promise<Session[]> {
  const db = getDb();
  if (characterId) {
    const { rows } = await db.query<SessionRow>(
      `select s.*, (select count(*) from messages m where m.session_id = s.id) as message_count
       from sessions s where s.character_id = $1
       order by s.pinned desc, s.updated_at desc`,
      [characterId],
    );
    return rows.map(mapSession);
  }
  const { rows } = await db.query<SessionRow>(
    `select s.*, (select count(*) from messages m where m.session_id = s.id) as message_count
     from sessions s order by s.pinned desc, s.updated_at desc`,
  );
  return rows.map(mapSession);
}

export async function createSession(input: {
  spaceId: string;
  characterId: string;
  title?: string;
}): Promise<Session> {
  const id = uid();
  const ts = nowIso();
  const { rows } = await getDb().query<SessionRow>(
    `insert into sessions (id, space_id, character_id, title, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$5) returning *`,
    [id, input.spaceId, input.characterId, input.title ?? "新会话", ts],
  );
  return mapSession(rows[0]);
}

export async function updateSession(
  id: string,
  patch: { title?: string; pinned?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    values.push(patch.title);
    sets.push(`title = $${values.length}`);
  }
  if (patch.pinned !== undefined) {
    values.push(patch.pinned);
    sets.push(`pinned = $${values.length}`);
  }
  values.push(nowIso());
  sets.push(`updated_at = $${values.length}`);
  values.push(id);
  await getDb().query(`update sessions set ${sets.join(", ")} where id = $${values.length}`, values);
}

export async function touchSession(id: string): Promise<void> {
  await getDb().query("update sessions set updated_at = $1 where id = $2", [nowIso(), id]);
}

export async function deleteSession(id: string): Promise<void> {
  await getDb().query("delete from sessions where id = $1", [id]);
}

/**
 * 分支对话：用一段现有消息搭一个新会话。
 *
 * 消息要换新 id 再插一遍 —— messages.id 是全局主键，直接搬会撞原会话那些行；
 * created_at 顺延成严格递增的，否则同一毫秒内的两条在 `order by created_at, id`
 * 下会按随机 id 重排，分支里的对话顺序就跟原会话对不上了。
 */
export async function branchSession(input: {
  spaceId: string;
  characterId: string;
  title: string;
  messages: Message[];
}): Promise<Session> {
  const db = getDb();
  const sessionId = uid();
  const ts = nowIso();
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<SessionRow>(
      `insert into sessions (id, space_id, character_id, title, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$5) returning *`,
      [sessionId, input.spaceId, input.characterId, input.title, ts],
    );
    let last = 0;
    for (const m of input.messages) {
      const parsed = Date.parse(m.createdAt);
      let stamp = Number.isFinite(parsed) ? parsed : last || Date.now();
      if (stamp <= last) stamp = last + 1;
      last = stamp;
      await tx.query(
        `insert into messages (id, session_id, role, content, status, meta, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          uid(),
          sessionId,
          m.role,
          m.content,
          // 半截的流式消息带不进分支，按「已停止」的成品存下来
          m.status === "streaming" ? "stopped" : m.status,
          JSON.stringify(m.meta ?? {}),
          new Date(stamp).toISOString(),
        ],
      );
    }
    return mapSession(rows[0]);
  });
}

/* --------------------------------- messages ------------------------------- */

export async function listMessages(sessionId: string): Promise<Message[]> {
  const { rows } = await getDb().query<MessageRow>(
    "select * from messages where session_id = $1 order by created_at asc, id asc",
    [sessionId],
  );
  return rows.map(mapMessage);
}

/**
 * 正文里带花括号的消息，供启动时的一次性清洗使用。
 * 用 `like` 先在 SQL 里过一遍，避免每开一次应用就把全部历史反序列化进内存。
 */
export async function listJsonSuspectMessages(): Promise<Message[]> {
  const { rows } = await getDb().query<MessageRow>(
    "select * from messages where content like '%{%' order by created_at asc",
  );
  return rows.map(mapMessage);
}

export async function appendMessage(input: {
  sessionId: string;
  role: Message["role"];
  content: string;
  status?: Message["status"];
  meta?: MessageMeta;
  id?: string;
  createdAt?: string;
}): Promise<Message> {
  const id = input.id ?? uid();
  const ts = input.createdAt ?? nowIso();
  const { rows } = await getDb().query<MessageRow>(
    `insert into messages (id, session_id, role, content, status, meta, created_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
    [
      id,
      input.sessionId,
      input.role,
      input.content,
      input.status ?? "done",
      JSON.stringify(input.meta ?? {}),
      ts,
    ],
  );
  await touchSession(input.sessionId);
  return mapMessage(rows[0]);
}

export async function updateMessage(
  id: string,
  patch: { content?: string; status?: Message["status"]; meta?: MessageMeta },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.content !== undefined) {
    values.push(patch.content);
    sets.push(`content = $${values.length}`);
  }
  if (patch.status !== undefined) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (patch.meta !== undefined) {
    values.push(JSON.stringify(patch.meta));
    sets.push(`meta = $${values.length}::jsonb`);
  }
  if (!sets.length) return;
  values.push(id);
  await getDb().query(`update messages set ${sets.join(", ")} where id = $${values.length}`, values);
}

export async function deleteMessage(id: string): Promise<void> {
  await getDb().query("delete from messages where id = $1", [id]);
}

/** 删除某条消息之后（不含）的全部消息，用于编辑重发 / 重新生成 */
export async function truncateAfter(sessionId: string, messageId: string): Promise<void> {
  await getDb().query(
    `delete from messages
     where session_id = $1
       and created_at > (select created_at from messages where id = $2)`,
    [sessionId, messageId],
  );
}

/** 删除某条消息之后（含）的全部消息，用于编辑重发 / 重新生成 */
export async function deleteMessagesFrom(sessionId: string, messageId: string): Promise<void> {
  const { rows } = await getDb().query<{ created_at: string | Date }>(
    "select created_at from messages where id = $1",
    [messageId],
  );
  if (!rows[0]) return;
  await getDb().query("delete from messages where session_id = $1 and created_at >= $2", [
    sessionId,
    rows[0].created_at,
  ]);
}

/* --------------------------------- images -------------------------------- */

export async function listImages(sessionId: string): Promise<MessageImage[]> {
  const { rows } = await getDb().query<ImageRow>(
    "select * from images where session_id = $1 order by created_at asc, id asc",
    [sessionId],
  );
  return rows.map(mapImage);
}

export async function appendImage(input: {
  sessionId: string;
  characterId: string;
  messageId: string;
  prompt: string;
  rawPrompt: string;
  baseImageId?: string | null;
  url: string;
  model?: string;
  status?: MessageImage["status"];
  error?: string;
}): Promise<MessageImage> {
  const { rows } = await getDb().query<ImageRow>(
    `insert into images
      (id, session_id, character_id, message_id, prompt, raw_prompt, base_image_id, url, model, status, error, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [
      // images.id 是 uuid 列，不能用带前缀的 uid
      uid(),
      input.sessionId,
      input.characterId,
      input.messageId,
      input.prompt,
      input.rawPrompt,
      input.baseImageId ?? null,
      input.url,
      input.model ?? "",
      input.status ?? "done",
      input.error ?? "",
      nowIso(),
    ],
  );
  return mapImage(rows[0]);
}

export async function deleteImage(id: string): Promise<void> {
  await getDb().query("delete from images where id = $1", [id]);
}

/**
 * 消息被删 / 被截断后，把它名下已经没人认领的图一起清掉。
 *
 * `keep` 用来放过「消息行还没落库」的在途图：流式途中抓到生图 JSON 就先开画，
 * 图可能比消息先写进库里，这时它是合法孤儿，不能被当成垃圾删掉。
 */
export async function pruneImages(sessionId: string, keep?: string): Promise<void> {
  const guard = keep ? "and i.message_id <> $2" : "";
  await getDb().query(
    `delete from images i
     where i.session_id = $1
       ${guard}
       and not exists (select 1 from messages m where m.id = i.message_id)`,
    keep ? [sessionId, keep] : [sessionId],
  );
}

/* --------------------------------- settings ------------------------------- */

export async function loadSettings(): Promise<Record<string, unknown>> {
  const { rows } = await getDb().query<{ key: string; value: unknown }>("select key, value from settings");
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await getDb().query(
    `insert into settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

/* ------------------------------ export / import --------------------------- */

export interface BackupFile {
  app: "rp-studio";
  version: 2;
  exportedAt: string;
  spaces: Space[];
  characters: Character[];
  sessions: Session[];
  messages: Message[];
  /** 更早的备份没有这一段，导入时按空数组处理 */
  images?: MessageImage[];
  settings: Record<string, unknown>;
}

/** 老备份（v1）：characters 里装的是「角色卡」，没有空间这一层 */
export interface LegacyBackupFile {
  app: "rp-studio";
  version?: number;
  exportedAt?: string;
  characters: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  messages: Message[];
  images?: MessageImage[];
  settings: Record<string, unknown>;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);

export async function exportAll(): Promise<BackupFile> {
  const db = getDb();
  const [spaces, chars, sess, msgs, imgs, settings] = await Promise.all([
    db.query<SpaceRow>("select * from spaces order by created_at"),
    db.query<CharacterRow>("select * from characters order by space_id, sort_order, created_at"),
    db.query<SessionRow>("select * from sessions order by created_at"),
    db.query<MessageRow>("select * from messages order by created_at"),
    db.query<ImageRow>("select * from images order by created_at"),
    db.query<{ key: string; value: unknown }>("select key, value from settings"),
  ]);
  const settingsObj: Record<string, unknown> = {};
  for (const s of settings.rows) settingsObj[s.key] = s.value;
  return {
    app: "rp-studio",
    version: 2,
    exportedAt: nowIso(),
    spaces: spaces.rows.map(mapSpace),
    characters: chars.rows.map(mapCharacter),
    sessions: sess.rows.map(mapSession),
    messages: msgs.rows.map(mapMessage),
    images: imgs.rows.map(mapImage),
    settings: settingsObj,
  };
}

/** 老备份里的一张「角色卡」→ 一个空间（保留原 id，会话的旧引用才不用重算） */
function spaceFromLegacyCard(card: Record<string, unknown>): Space {
  const seeds = asImageSeeds(card.imageSeeds, str(card.imageSeed));
  return {
    id: str(card.id, uid()),
    name: str(card.name, "未命名空间"),
    avatar: str(card.avatar, "🎭"),
    systemPrompt: str(card.systemPrompt),
    imageSeeds: seeds,
    // 老卡里的块没有「角色专属提示」，补一条；其余原样保留（脏块先规整一遍）
    contextBlocks: ensureCharacterBlock(
      normalizeContextBlocks(
        Array.isArray(card.contextBlocks) ? card.contextBlocks : defaultContextBlocks(),
      ),
    ),
    quickPhrases: Array.isArray(card.quickPhrases) ? (card.quickPhrases as QuickPhrase[]) : [],
    workflow: (card.workflow as Workflow) ?? { enabled: false, nodes: [], edges: [] },
    script: str(card.script),
    createdAt: str(card.createdAt, nowIso()),
    updatedAt: str(card.updatedAt, nowIso()),
  };
}

function characterFromLegacyCard(card: Record<string, unknown>, space: Space): Character {
  return {
    id: uid(),
    spaceId: space.id,
    name: space.name,
    avatar: space.avatar,
    greeting: str(card.greeting),
    // 老卡的系统提示词整体留在空间，专属提示留空 —— 用户想给角色加话再自己填
    systemPrompt: "",
    activeSeed: str(card.activeSeed) || str(card.imageSeed) || space.imageSeeds.find(Boolean) || "",
    sortOrder: 0,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

export async function importAll(data: BackupFile | LegacyBackupFile): Promise<void> {
  if (!data || data.app !== "rp-studio") throw new Error("备份文件格式不正确");

  let spaces: Space[];
  let characters: Character[];
  let sessions: Session[];
  /** 老备份里 session.characterId 指的是空间 id，导入时要换成新生成的角色 id */
  let legacyCharacterOf: Map<string, string> | null = null;

  if (Array.isArray((data as BackupFile).spaces)) {
    const backup = data as BackupFile;
    spaces = backup.spaces;
    characters = Array.isArray(backup.characters) ? backup.characters : [];
    sessions = Array.isArray(backup.sessions) ? backup.sessions : [];
  } else if (Array.isArray((data as LegacyBackupFile).characters)) {
    const backup = data as LegacyBackupFile;
    spaces = backup.characters.map(spaceFromLegacyCard);
    characters = backup.characters.map((card, index) => characterFromLegacyCard(card, spaces[index]));
    legacyCharacterOf = new Map(spaces.map((space, index) => [space.id, characters[index].id]));
    sessions = (backup.sessions ?? []).map((raw) => {
      const spaceId = str(raw.spaceId) || str(raw.characterId);
      return {
        id: str(raw.id, uid()),
        spaceId,
        characterId: legacyCharacterOf?.get(spaceId) ?? str(raw.characterId),
        title: str(raw.title, "新会话"),
        pinned: Boolean(raw.pinned),
        createdAt: str(raw.createdAt, nowIso()),
        updatedAt: str(raw.updatedAt, nowIso()),
      };
    });
  } else {
    throw new Error("备份文件格式不正确");
  }

  if (!spaces.length) throw new Error("备份文件里没有空间数据");

  for (const space of spaces) {
    if (!characters.some((c) => c.spaceId === space.id)) {
      characters.push(characterFromLegacyCard({}, space));
    }
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.exec(
      "delete from images; delete from messages; delete from sessions; delete from characters; delete from spaces; delete from settings;",
    );
    for (const s of spaces) {
      await tx.query(
        `insert into spaces
          (id,name,avatar,image_seed,image_seeds,system_prompt,context_blocks,quick_phrases,workflow,script,created_at,updated_at)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
        [
          s.id,
          s.name,
          s.avatar,
          "",
          JSON.stringify(s.imageSeeds ?? []),
          s.systemPrompt ?? "",
          JSON.stringify(ensureCharacterBlock(normalizeContextBlocks(s.contextBlocks))),
          JSON.stringify(s.quickPhrases ?? []),
          JSON.stringify(s.workflow ?? { enabled: false, nodes: [], edges: [] }),
          s.script ?? "",
          s.createdAt,
          s.updatedAt,
        ],
      );
    }
    for (const c of characters) {
      await tx.query(
        `insert into characters
          (id,space_id,name,avatar,greeting,system_prompt,active_seed,sort_order,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          c.id,
          c.spaceId,
          c.name,
          c.avatar || "🎭",
          c.greeting ?? "",
          c.systemPrompt ?? "",
          c.activeSeed ?? "",
          num(c.sortOrder),
          c.createdAt,
          c.updatedAt,
        ],
      );
    }
    for (const s of sessions) {
      await tx.query(
        `insert into sessions (id,space_id,character_id,title,pinned,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [s.id, s.spaceId, s.characterId, s.title, s.pinned, s.createdAt, s.updatedAt],
      );
    }
    for (const m of data.messages ?? []) {
      await tx.query(
        `insert into messages (id,session_id,role,content,status,meta,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [m.id, m.sessionId, m.role, m.content, m.status ?? "done", JSON.stringify(m.meta ?? {}), m.createdAt],
      );
    }
    for (const img of data.images ?? []) {
      await tx.query(
        `insert into images (id,session_id,character_id,message_id,prompt,raw_prompt,base_image_id,url,model,status,error,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          img.id,
          img.sessionId,
          img.characterId,
          img.messageId,
          img.prompt ?? "",
          img.rawPrompt ?? "",
          img.baseImageId ?? null,
          img.url,
          img.model ?? "",
          img.status ?? "done",
          img.error ?? "",
          img.createdAt,
        ],
      );
    }
    for (const [key, value] of Object.entries(data.settings ?? {})) {
      await tx.query("insert into settings (key,value) values ($1,$2::jsonb)", [key, JSON.stringify(value)]);
    }
  });
}

export async function clearAllData(): Promise<void> {
  await getDb().exec(
    "delete from images; delete from messages; delete from sessions; delete from characters; delete from spaces; delete from settings;",
  );
}

export async function dbStats(): Promise<{
  spaces: number;
  characters: number;
  sessions: number;
  messages: number;
}> {
  const { rows } = await getDb().query<{
    spaces: string;
    characters: string;
    sessions: string;
    messages: string;
  }>(
    `select
      (select count(*) from spaces) as spaces,
      (select count(*) from characters) as characters,
      (select count(*) from sessions) as sessions,
      (select count(*) from messages) as messages`,
  );
  const r = rows[0];
  return {
    spaces: Number(r?.spaces ?? 0),
    characters: Number(r?.characters ?? 0),
    sessions: Number(r?.sessions ?? 0),
    messages: Number(r?.messages ?? 0),
  };
}
