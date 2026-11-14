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
  {
    /**
     * 角色卡 → 「空间 + 角色」双层：
     * - 原来的 characters 表整体改名成 spaces（id 不变，会话 / 图片的老引用不用重算）；
     * - 新建 characters 表当子级，一张老卡自动生成一个同名角色，继承开场白与当前底图；
     * - sessions 拆成 space_id + character_id，老会话挂到那个唯一角色上；
     * - 上下文编排补一个「角色专属提示」块（插在系统提示之后），专属提示词才有落点。
     */
    version: 5,
    sql: `
      alter table characters rename to spaces;

      create table if not exists characters (
        id uuid primary key,
        space_id uuid not null references spaces(id) on delete cascade,
        name text not null,
        avatar text not null default '🎭',
        tagline text not null default '',
        description text not null default '',
        greeting text not null default '',
        system_prompt text not null default '',
        active_seed text not null default '',
        sort_order int not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_characters_space on characters(space_id, sort_order, created_at);

      insert into characters
        (id, space_id, name, avatar, tagline, description, greeting, system_prompt, active_seed, sort_order, created_at, updated_at)
      select
        md5(random()::text || clock_timestamp()::text || s.id::text)::uuid,
        s.id, s.name, s.avatar, s.tagline, s.description, s.greeting, '', coalesce(s.image_seed, ''), 0,
        s.created_at, s.updated_at
      from spaces s;

      update spaces s
         set context_blocks = sub.blocks
        from (
          select space.id,
                 (select jsonb_agg(item.elem order by item.ord)
                    from (
                      select elem, ord
                        from jsonb_array_elements(space.context_blocks) with ordinality as a(elem, ord)
                      union all
                      select jsonb_build_object(
                               'id', 'blk-character', 'kind', 'character',
                               'enabled', true, 'label', '角色专属提示'
                             ),
                             coalesce(
                               (select min(b.ord)
                                  from jsonb_array_elements(space.context_blocks) with ordinality as b(elem2, ord)
                                 where elem2->>'kind' = 'system'),
                               0
                             ) + 0.5
                    ) item
                 ) as blocks
            from spaces space
        ) sub
       where sub.id = s.id
         and jsonb_array_length(s.context_blocks) > 0;

      alter table sessions rename column character_id to space_id;
      drop index if exists idx_sessions_character;
      create index if not exists idx_sessions_space on sessions(space_id, updated_at desc);

      alter table sessions add column if not exists character_id uuid references characters(id) on delete cascade;

      update sessions se
         set character_id = (
           select c.id from characters c
            where c.space_id = se.space_id
            order by c.sort_order, c.created_at
            limit 1
         );

      alter table sessions alter column character_id set not null;
      create index if not exists idx_sessions_character on sessions(character_id, updated_at desc);

      update images i
         set character_id = (
           select c.id from characters c
            where c.space_id = i.character_id
            order by c.sort_order, c.created_at
            limit 1
         )
       where exists (select 1 from spaces sp where sp.id = i.character_id);
    `,
  },
  {
    /**
     * v6：角色不再有「一句话简介」和「角色描述」。
     * 这两栏原本只用于展示，人物设定统一写进 systemPrompt —— 会话首页
     * 直接展示它，不必再维护一份会被判定为「过期」的摘要。
     * 空间上的同名两列保留（那是空间自己的简介与描述）。
     */
    version: 6,
    sql: `
      alter table characters drop column if exists tagline;
      alter table characters drop column if exists description;
    `,
  },
  {
    /**
     * v7：空间也不再保留「一句话简介」和「空间说明」。
     * 这两栏只用于左栏副标题和一屏介绍，实际设定都写在共享系统提示词里；
     * 与其维护一份会和提示词不一致的摘要，不如只留名字。
     */
    version: 7,
    sql: `
      alter table spaces drop column if exists tagline;
      alter table spaces drop column if exists description;
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
    drop table if exists spaces cascade;
    drop table if exists settings cascade;
    drop table if exists schema_meta cascade;
  `);
  readyPromise = null;
  await initDb();
}
