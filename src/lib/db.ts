import type { PGlite } from "@electric-sql/pglite";

/**
 * 浏览器内 Postgres：数据目录走 IndexedDB，刷新不丢。
 * 首次加载需要下载 WASM，约 3MB。
 *
 * 这里用动态 import 拿下 PGlite：它的 JS 构建出来有 480KB 左右，静态引入会让主包
 * 在解析完之后才能吐出首屏。改成懒加载后，React 外壳和启动动画先画出来，
 * 数据库在后台加载，用户看到的是「正在启动本地数据库」而不是白屏。
 */
type PGliteCtor = typeof import("@electric-sql/pglite").PGlite;

let instance: PGlite | null = null;
let readyPromise: Promise<PGlite> | null = null;

/** 只能在 initDb() 之后调用；之前的数据库调用都是 bug，直接报出来 */
export function getDb(): PGlite {
  if (!instance) throw new Error("数据库尚未初始化");
  return instance;
}

async function createDb(): Promise<PGlite> {
  const { PGlite: Ctor } = (await import("@electric-sql/pglite")) as { PGlite: PGliteCtor };
  return new Ctor("idb://rp-studio");
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      create table if not exists characters (
        id uuid primary key,
        name text not null,
        avatar text not null default '🎭',
        tagline text not null default '',
        description text not null default '',
        system_prompt text not null default '',
        context_blocks jsonb not null default '[]'::jsonb,
        quick_phrases jsonb not null default '[]'::jsonb,
        workflow jsonb not null default '{}'::jsonb,
        script text not null default '',
        model_override jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists sessions (
        id uuid primary key,
        character_id uuid not null references characters(id) on delete cascade,
        title text not null default '新会话',
        pinned boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists messages (
        id uuid primary key,
        session_id uuid not null references sessions(id) on delete cascade,
        role text not null check (role in ('system','user','assistant')),
        content text not null default '',
        status text not null default 'done',
        meta jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create table if not exists settings (
        key text primary key,
        value jsonb not null
      );

      create index if not exists idx_sessions_character on sessions(character_id, updated_at desc);
      create index if not exists idx_messages_session on messages(session_id, created_at asc);
    `,
  },
  {
    version: 2,
    sql: `alter table characters add column if not exists greeting text not null default '';`,
  },
  {
    /**
     * 生图：角色卡带一张初始底图；生成结果单独成表而不是塞 message.meta ——
     * 一张 1024 的图压完也有一两百 KB，塞进消息 jsonb 会让每次 listMessages 都变沉。
     * images 是二维结构：message_id 是第一维（绑定哪条气泡），
     * 同一 message_id 下的多行就是第二维（多次重新生图，按 created_at 排序）。
     */
    version: 3,
    sql: `
      alter table characters add column if not exists image_seed text not null default '';

      create table if not exists images (
        id uuid primary key,
        session_id uuid not null references sessions(id) on delete cascade,
        character_id uuid not null,
        message_id uuid,
        prompt text not null default '',
        raw_prompt text not null default '',
        base_image_id uuid,
        url text not null default '',
        model text not null default '',
        status text not null default 'done',
        error text not null default '',
        created_at timestamptz not null default now()
      );

      create index if not exists idx_images_session on images(session_id, created_at asc);
      create index if not exists idx_images_message on images(message_id, created_at asc);
    `,
  },
  {
    /**
     * 底图从「一张」升级成多槽位（当时代指三视图：正面证件照 / 侧面全身照 / 背面俯视照）：
     * 新列存数组，老数据把 image_seed 那唯一一张挪进第一个槽位。image_seed 列保留不删 ——
     * 导入旧备份时仍然照它写，读的时候当兜底。
     * 现在界面只传一张（正面全身照），数组留着的意义就是兼容这一段老数据。
     */
    version: 4,
    sql: `
      alter table characters add column if not exists image_seeds jsonb not null default '[]'::jsonb;

      update characters
         set image_seeds = jsonb_build_array(image_seed)
       where coalesce(image_seed, '') <> ''
         and jsonb_array_length(image_seeds) = 0;
    `,
  },
];

export async function initDb(): Promise<PGlite> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const db = instance ?? (instance = await createDb());
    await db.waitReady;
    await db.exec(`
      create table if not exists schema_meta (
        id int primary key default 1,
        version int not null default 0
      );
      insert into schema_meta (id, version) values (1, 0) on conflict (id) do nothing;
    `);

    const { rows } = await db.query<{ version: number }>("select version from schema_meta where id = 1");
    let current = rows[0]?.version ?? 0;

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query("update schema_meta set version = $1 where id = 1", [migration.version]);
      });
      current = migration.version;
    }
    return db;
  })();
  return readyPromise;
}

export async function resetDatabase(): Promise<void> {
  const db = getDb();
  await db.exec(`
    drop table if exists images cascade;
    drop table if exists messages cascade;
    drop table if exists sessions cascade;
    drop table if exists characters cascade;
    drop table if exists settings cascade;
    drop table if exists schema_meta cascade;
  `);
  readyPromise = null;
  await initDb();
}
