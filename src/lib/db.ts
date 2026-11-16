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

/**
 * 实例挂在 globalThis 上而不是模块变量里：开发时热替换会重新执行这个文件，模块变量跟着重置，
 * 于是新旧两个 PGlite 同时指向同一个 `idb://rp-studio` —— 它们会在提交迁移时互相踩，
 * 留下「`schema_meta` 到了新版本、表却没建出来」的半截库。挂着复用同一个实例，
 * 真正的页面刷新才会重建（那时旧实例已随页面销毁，不会并存）。
 */
const DB_SLOT_KEY = "__rpStudioDb";
type DbSlot = { instance: PGlite | null; ready: Promise<PGlite> | null };
const slot: DbSlot = ((globalThis as unknown as Record<string, DbSlot>)[DB_SLOT_KEY] ??= {
  instance: null,
  ready: null,
});

/** 只能在 initDb() 之后调用；之前的数据库调用都是 bug，直接报出来 */
export function getDb(): PGlite {
  if (!slot.instance) throw new Error("数据库尚未初始化");
  return slot.instance;
}

async function createDb(): Promise<PGlite> {
  const { PGlite: Ctor } = (await import("@electric-sql/pglite")) as { PGlite: PGliteCtor };
  return new Ctor("idb://rp-studio");
}

/**
 * 角色档案的表结构：加列 / 建表 / 建索引，全部 `if not exists`，重复执行无副作用。
 * v8 建它、v9 补齐它、`initDb` 的启动兜底也补它 —— 三处共用同一段，改结构只改这里。
 */
const PROFILE_DDL = `
  alter table spaces add column if not exists profile jsonb not null default '{}'::jsonb;

  create table if not exists profiles (
    id uuid primary key,
    session_id uuid not null references sessions(id) on delete cascade,
    round int not null default 0,
    content text not null default '',
    created_at timestamptz not null default now()
  );

  create index if not exists idx_profiles_session on profiles(session_id, round asc);
`;

/**
 * 把编排里的「角色档案」块挪到「用户回复」之前：档案是这一刻的状态，
 * 放在提问前读到的最后一段 system 里最有效，也让「用户回复」永远是最后一条。
 * 没有 user 块就落到末尾；重排后位置不再变化，重复执行是幂等的。
 */
const PROFILE_BLOCK_ORDER = `
  update spaces s
     set context_blocks = sub.blocks
    from (
      select space.id,
             (select jsonb_agg(item.elem order by item.ord)
                from (
                  select elem, ord
                    from jsonb_array_elements(space.context_blocks) with ordinality as a(elem, ord)
                   where elem->>'kind' <> 'character'
                  union all
                  select c.elem,
                         coalesce(
                           (select min(b.ord)
                              from jsonb_array_elements(space.context_blocks) with ordinality as b(elem2, ord)
                             where elem2->>'kind' = 'user'),
                           jsonb_array_length(space.context_blocks) + 1
                         ) - 0.5
                    from (
                      select elem
                        from jsonb_array_elements(space.context_blocks) with ordinality as x(elem, ord)
                       where elem->>'kind' = 'character'
                       limit 1
                    ) c
                ) item
             ) as blocks
        from spaces space
    ) sub
   where sub.id = s.id
     and jsonb_typeof(s.context_blocks) = 'array'
     and exists (
       select 1 from jsonb_array_elements(s.context_blocks) as e where e->>'kind' = 'character'
     );
`;

/**
 * 迁移清单：按 version 递增，每条在自己的事务里跑完才写 `schema_meta.version`。
 * 导出是为了能在 Node 里用内存 PGlite 跑一遍（见 README「迁移怎么验」），应用内只由 `initDb` 使用。
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
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
  {
    /**
     * v8：角色设定升级成「角色档案」。
     * - `profiles` 一表一版：`round` 是它覆盖到的轮数，0 那一版不落库（直接用角色设定原文），
     *   所以一个会话的档案就是这张表里按 round 递增的若干行；截断历史时按 round 往回删。
     * - 空间多一份 `profile` 配置（开关 / 每 N 轮 / 合并指令）。
     * - 编排里的「角色档案」块挪到「用户回复」之前（见 `PROFILE_BLOCK_ORDER`）。
     */
    version: 8,
    sql: `${PROFILE_DDL}${PROFILE_BLOCK_ORDER}`,
  },
  {
    /**
     * v9：把 v8 的建表再跑一遍。
     * PGlite 的数据目录在 IndexedDB 上，页面在提交途中重载、或者两个标签同时初始化同一个
     * `idb://`，都可能留下「`schema_meta` 已经是 8、`profiles` 表却没有」的半截状态。
     * 迁移只按版本号决定跑不跑，不会自己发现这种不一致，于是启动后第一次查档案就炸。
     * 这条的存在意义就是补回来：DDL 全是 `if not exists`，跑在有表的库上什么也不做。
     */
    version: 9,
    sql: `${PROFILE_DDL}${PROFILE_BLOCK_ORDER}`,
  },
];

export async function initDb(): Promise<PGlite> {
  if (slot.ready) return slot.ready;
  slot.ready = (async () => {
    const db = slot.instance ?? (slot.instance = await createDb());
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
      try {
        await db.transaction(async (tx) => {
          await tx.exec(migration.sql);
          await tx.query("update schema_meta set version = $1 where id = 1", [migration.version]);
        });
      } catch (err) {
        // 失败时把版本号带出来：启动页只有一行错误文案，不标版本基本查不出是哪一步
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`迁移 v${migration.version} 失败：${detail}`);
      }
      current = migration.version;
    }

    // 版本号可能比库里的结构「新」——提交到一半被重载、两个标签同时初始化同一个 idb://
    // 都会留下这种半截状态。迁移只按版本号跑，不会自己发现，所以按真实结构兜一次。
    await ensureProfileSchema(db);
    return db;
  })();
  return slot.ready;
}

/** 启动兜底：以实际结构为准，缺表 / 缺列就补（DDL 幂等，跑在有表的库上不用做事） */
async function ensureProfileSchema(db: PGlite): Promise<void> {
  const { rows } = await db.query<{ hasTable: boolean; hasColumn: boolean }>(
    `select to_regclass('public.profiles') is not null as "hasTable",
            exists (
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'spaces' and column_name = 'profile'
            ) as "hasColumn"`,
  );
  const shape = rows[0];
  if (shape?.hasTable && shape?.hasColumn) return;
  await db.exec(PROFILE_DDL);
}

export async function resetDatabase(): Promise<void> {
  const db = getDb();
  await db.exec(`
    drop table if exists profiles cascade;
    drop table if exists images cascade;
    drop table if exists messages cascade;
    drop table if exists sessions cascade;
    drop table if exists characters cascade;
    drop table if exists spaces cascade;
    drop table if exists settings cascade;
    drop table if exists schema_meta cascade;
  `);
  slot.ready = null;
  await initDb();
}
