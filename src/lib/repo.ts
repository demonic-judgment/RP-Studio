import { getDb } from "./db";
import type {
  Character,
  CharacterDraft,
  Message,
  MessageMeta,
  ModelOverride,
  QuickPhrase,
  Session,
  Workflow,
  ContextBlock,
} from "./types";
import { nowIso, uid } from "./utils";
import { defaultContextBlocks } from "./context";

/* ------------------------------- row mapping ------------------------------ */

type CharRow = {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  description: string;
  greeting: string;
  system_prompt: string;
  context_blocks: unknown;
  quick_phrases: unknown;
  workflow: unknown;
  script: string;
  model_override: unknown;
  created_at: string | Date;
  updated_at: string | Date;
};

type SessionRow = {
  id: string;
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

const iso = (v: string | Date | null | undefined): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : nowIso();

const asObject = <T>(v: unknown, fallback: T): T =>
  v && typeof v === "object" ? (v as T) : fallback;

function mapCharacter(row: CharRow): Character {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    tagline: row.tagline,
    description: row.description,
    greeting: row.greeting ?? "",
    systemPrompt: row.system_prompt,
    contextBlocks: asObject<ContextBlock[]>(row.context_blocks, []),
    quickPhrases: asObject<QuickPhrase[]>(row.quick_phrases, []),
    workflow: asObject<Workflow>(row.workflow, { enabled: false, nodes: [], edges: [] }),
    script: row.script ?? "",
    modelOverride: asObject<ModelOverride>(row.model_override, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
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

/* -------------------------------- characters ------------------------------ */

export async function listCharacters(): Promise<Character[]> {
  const { rows } = await getDb().query<CharRow>(
    "select * from characters order by updated_at desc",
  );
  return rows.map(mapCharacter);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const { rows } = await getDb().query<CharRow>("select * from characters where id = $1", [id]);
  return rows[0] ? mapCharacter(rows[0]) : null;
}

export async function createCharacter(draft: Partial<CharacterDraft> = {}): Promise<Character> {
  const id = draft.id ?? uid();
  const ts = nowIso();
  const payload = {
    name: draft.name?.trim() || "新角色",
    avatar: draft.avatar || "🎭",
    tagline: draft.tagline || "",
    description: draft.description || "",
    greeting: draft.greeting || "",
    systemPrompt: draft.systemPrompt || "",
    contextBlocks: draft.contextBlocks ?? defaultContextBlocks(),
    quickPhrases: draft.quickPhrases ?? [],
    workflow: draft.workflow ?? { enabled: false, nodes: [], edges: [] },
    script: draft.script ?? "",
    modelOverride: draft.modelOverride ?? {},
  };
  const { rows } = await getDb().query<CharRow>(
    `insert into characters
      (id, name, avatar, tagline, description, greeting, system_prompt, context_blocks, quick_phrases, workflow, script, model_override, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$13)
     returning *`,
    [
      id,
      payload.name,
      payload.avatar,
      payload.tagline,
      payload.description,
      payload.greeting,
      payload.systemPrompt,
      JSON.stringify(payload.contextBlocks),
      JSON.stringify(payload.quickPhrases),
      JSON.stringify(payload.workflow),
      payload.script,
      JSON.stringify(payload.modelOverride),
      ts,
    ],
  );
  return mapCharacter(rows[0]);
}

export async function updateCharacter(
  id: string,
  patch: Partial<CharacterDraft>,
): Promise<Character> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.avatar !== undefined) push("avatar", patch.avatar);
  if (patch.tagline !== undefined) push("tagline", patch.tagline);
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.greeting !== undefined) push("greeting", patch.greeting);
  if (patch.systemPrompt !== undefined) push("system_prompt", patch.systemPrompt);
  if (patch.contextBlocks !== undefined) push("context_blocks", JSON.stringify(patch.contextBlocks), "::jsonb");
  if (patch.quickPhrases !== undefined) push("quick_phrases", JSON.stringify(patch.quickPhrases), "::jsonb");
  if (patch.workflow !== undefined) push("workflow", JSON.stringify(patch.workflow), "::jsonb");
  if (patch.script !== undefined) push("script", patch.script);
  if (patch.modelOverride !== undefined) push("model_override", JSON.stringify(patch.modelOverride), "::jsonb");

  push("updated_at", nowIso());
  values.push(id);
  const { rows } = await getDb().query<CharRow>(
    `update characters set ${sets.join(", ")} where id = $${values.length} returning *`,
    values,
  );
  if (!rows[0]) throw new Error("角色不存在");
  return mapCharacter(rows[0]);
}

export async function deleteCharacter(id: string): Promise<void> {
  await getDb().query("delete from characters where id = $1", [id]);
}

/* --------------------------------- sessions ------------------------------- */

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

export async function createSession(characterId: string, title = "新会话"): Promise<Session> {
  const id = uid();
  const ts = nowIso();
  const { rows } = await getDb().query<SessionRow>(
    `insert into sessions (id, character_id, title, created_at, updated_at)
     values ($1,$2,$3,$4,$4) returning *`,
    [id, characterId, title, ts],
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

/* --------------------------------- messages ------------------------------- */

export async function listMessages(sessionId: string): Promise<Message[]> {
  const { rows } = await getDb().query<MessageRow>(
    "select * from messages where session_id = $1 order by created_at asc, id asc",
    [sessionId],
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
  version: 1;
  exportedAt: string;
  characters: Character[];
  sessions: Session[];
  messages: Message[];
  settings: Record<string, unknown>;
}

export async function exportAll(): Promise<BackupFile> {
  const db = getDb();
  const [chars, sess, msgs, settings] = await Promise.all([
    db.query<CharRow>("select * from characters order by created_at"),
    db.query<SessionRow>("select * from sessions order by created_at"),
    db.query<MessageRow>("select * from messages order by created_at"),
    db.query<{ key: string; value: unknown }>("select key, value from settings"),
  ]);
  const settingsObj: Record<string, unknown> = {};
  for (const s of settings.rows) settingsObj[s.key] = s.value;
  return {
    app: "rp-studio",
    version: 1,
    exportedAt: nowIso(),
    characters: chars.rows.map(mapCharacter),
    sessions: sess.rows.map(mapSession),
    messages: msgs.rows.map(mapMessage),
    settings: settingsObj,
  };
}

export async function importAll(data: BackupFile): Promise<void> {
  if (!data || data.app !== "rp-studio" || !Array.isArray(data.characters)) {
    throw new Error("备份文件格式不正确");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.exec("delete from messages; delete from sessions; delete from characters; delete from settings;");
    for (const c of data.characters) {
      await tx.query(
        `insert into characters (id,name,avatar,tagline,description,greeting,system_prompt,context_blocks,quick_phrases,workflow,script,model_override,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14)`,
        [
          c.id,
          c.name,
          c.avatar,
          c.tagline,
          c.description,
          c.greeting ?? "",
          c.systemPrompt,
          JSON.stringify(c.contextBlocks ?? []),
          JSON.stringify(c.quickPhrases ?? []),
          JSON.stringify(c.workflow ?? { enabled: false, nodes: [], edges: [] }),
          c.script ?? "",
          JSON.stringify(c.modelOverride ?? {}),
          c.createdAt,
          c.updatedAt,
        ],
      );
    }
    for (const s of data.sessions) {
      await tx.query(
        `insert into sessions (id,character_id,title,pinned,created_at,updated_at) values ($1,$2,$3,$4,$5,$6)`,
        [s.id, s.characterId, s.title, s.pinned, s.createdAt, s.updatedAt],
      );
    }
    for (const m of data.messages) {
      await tx.query(
        `insert into messages (id,session_id,role,content,status,meta,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [m.id, m.sessionId, m.role, m.content, m.status ?? "done", JSON.stringify(m.meta ?? {}), m.createdAt],
      );
    }
    for (const [key, value] of Object.entries(data.settings ?? {})) {
      await tx.query("insert into settings (key,value) values ($1,$2::jsonb)", [key, JSON.stringify(value)]);
    }
  });
}

export async function clearAllData(): Promise<void> {
  await getDb().exec("delete from messages; delete from sessions; delete from characters; delete from settings;");
}

export async function dbStats(): Promise<{ characters: number; sessions: number; messages: number }> {
  const { rows } = await getDb().query<{ characters: string; sessions: string; messages: string }>(
    `select
      (select count(*) from characters) as characters,
      (select count(*) from sessions) as sessions,
      (select count(*) from messages) as messages`,
  );
  const r = rows[0];
  return {
    characters: Number(r?.characters ?? 0),
    sessions: Number(r?.sessions ?? 0),
    messages: Number(r?.messages ?? 0),
  };
}
