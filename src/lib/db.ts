import { PGlite } from "@electric-sql/pglite";

/**
 * 浏览器内 Postgres：数据目录走 IndexedDB，刷新不丢。
 * 首次加载需要下载 WASM，约 3MB。
 */
let instance: PGlite | null = null;
let readyPromise: Promise<PGlite> | null = null;

export function getDb(): PGlite {
  if (!instance) {
    instance = new PGlite("idb://rp-studio");
  }
  return instance;
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
];

export async function initDb(): Promise<PGlite> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const db = getDb();
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
    drop table if exists messages cascade;
    drop table if exists sessions cascade;
    drop table if exists characters cascade;
    drop table if exists settings cascade;
    drop table if exists schema_meta cascade;
  `);
  readyPromise = null;
  await initDb();
}
