# RP-Studio

> 一个完全跑在浏览器里的角色扮演工作室：提示词工程、上下文编排、节点工作流、脚本沙箱，配一套 Material 3 风格的界面。

**它是什么** — React 19 + TypeScript + Vite 的单页应用。用 PGlite（编译成 WASM 的 Postgres）把角色卡、会话、消息、模型配置全部存进浏览器 IndexedDB，**没有后端、没有账号、没有服务端数据库**；模型请求由浏览器直接发往任意 OpenAI 兼容网关。整站可作为静态资源部署到 Cloudflare Workers / Pages / Vercel / Netlify。

**它特别在哪** — 把「一次对话请求」拆成可观察、可编排的流水线：上下文块决定送什么 → 前置脚本可改写消息栈 → 工作流决定怎么调模型 → 结果带着执行日志落库。每个中间环节都能在界面上预览或试运行，而不是埋在一次 `fetch` 里。

**数据边界** — API Key 明文存在本地 IndexedDB；跨域调用依赖服务商的 CORS；PGlite 的 WASM 首次加载约 3 MB（gzip 后），之后由浏览器缓存。请勿在公用电脑上使用生产密钥。

---

## 界面预览

| 浅色对话界面 | 深色主题 |
| --- | --- |
| ![浅色对话](docs/chat-light.png) | ![深色主题](docs/chat-dark.png) |

| 上下文编排 | 全屏工作流 |
| --- | --- |
| ![上下文编排](docs/context.png) | ![全屏工作流](docs/workflow.png) |

| 设置抽屉 | 角色卡初始消息 |
| --- | --- |
| ![设置抽屉](docs/settings.png) | ![初始消息](docs/greeting.png) |

---

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # tsc --noEmit && vite build → dist/
pnpm preview    # 本地预览生产构建
pnpm deploy     # vite build && wrangler deploy（先 wrangler login）
```

`.npmrc` 已把 registry 指向 `https://registry.npmmirror.com`；`pnpm-workspace.yaml` 的 `allowBuilds` 放行 `esbuild` 与 `workerd` 的构建脚本。仓库未锁定 pnpm 版本。

---

## 1. 架构总览

```text
浏览器（单页，无服务端）
├─ 视图层   React 19 组件 + CSS 变量驱动的 Material 3 视觉系统
├─ 状态层   zustand 单 store：数据 / UI / 流式任务 / Toast
├─ 领域层   context 装配 · llm 请求 · workflow 执行 · script 沙箱
├─ 数据层   repo（SQL 仓储） → PGlite(WASM Postgres) → IndexedDB
└─ 外部     任意 OpenAI 兼容网关（浏览器 fetch + SSE，直连）
```

一次「发送」的完整链路（`src/lib/store.ts` 的 `regenerate` 是唯一入口）：

1. 定位目标消息，按 user / assistant 两种情形回溯 `input` 并 `truncateAfter` 截断后续消息；
2. `assembleContext()` 按角色卡的上下文块产出 `ChatMessage[]`，附带 trace 与 token 估算；
3. 角色卡若配置了前置脚本，`runScript()` 可返回新消息栈覆盖装配结果；
4. `resolveModel()` 把全局模型配置与角色级 `modelOverride` 合并（只接受非空字符串字段）；
5. 分流：`chatCompletion()` 直接请求，或 `runWorkflow()` 走 DFS 节点编排；`onDelta` 只写内存里的 `stream.buffer`；
6. `finish()` 在结束 / 中止 / 出错时**一次性**追加消息落库，状态为 `done` / `stopped` / `error`；中止与报错也会保留已生成的部分；
7. 流式期间消息列表渲染一条 `streaming-virtual` 虚拟消息，不写库。

> `src/main.tsx` 里 `initDb()` 是「即发即忘」并行启动，React 随后立即挂载；`App.tsx` 用 `ready` / `initError` 两个分支显示启动态与失败态。`initDb()` 通过 `readyPromise` 单例去重，被 `main.tsx` 与 `store.init()` 调用两次也不会重复建表。

---

## 2. 技术栈索引

> 这一章是**查表用**的：想知道某件事由谁负责、去哪个文件、依赖哪个库、有什么不能踩的坑，直接按层检索。逻辑层只做索引；界面长什么样、用起来什么感觉，用自然语言写在第 5 章。

### 2.1 构建与工具链

| 技术 / 版本 | 配置或入口 | 职责 | 不能踩的点 |
| --- | --- | --- | --- |
| React `^19.3.1` + react-dom | `src/main.tsx` | `StrictMode` + `createRoot` | — |
| TypeScript `^7.0.2` | `tsconfig.json` | ES2022 / `moduleResolution: bundler` / `strict` / `noUnused*` | `lib` 必须含 `WebWorker`（`script-worker.ts`），`types` 必须含 `node`（`vite.config.ts` 用 `node:url`） |
| Vite `^8.3.6` + `@vitejs/plugin-react` `^6.2.1` | `vite.config.ts` | 开发服务器 5173、`build.target: es2022` | **`optimizeDeps.exclude: ["@electric-sql/pglite"]`**：PGlite 用 `new URL("...wasm", import.meta.url)` 定位资源，进预构建会路径错乱 |
| Tailwind CSS `^4.3.5` + `@tailwindcss/vite` | `vite.config.ts`、`src/index.css` | 无 config 文件，全部靠 `@theme inline` | 见 S1；`@/*` 别名在 Vite 与 `components.json` 两处都要一致 |
| shadcn CLI `^4.23.0`（dev） | `components.json` | `new-york` / Tailwind v4 / `cssVariables: true` / `tailwind.config: ""` | 已初始化完毕，**不要再跑 `shadcn init`**，会覆盖主题变量；只用 `pnpm exec shadcn add <组件>` |
| wrangler `^4.158.0`（dev） | `wrangler.jsonc` | `assets.directory: ./dist` + `not_found_handling: single-page-application` | `run_worker_first: false`，纯静态，无 Worker 代码 |

### 2.2 数据与状态

| 技术 / 版本 | 入口文件 | 职责 | 关键决策 |
| --- | --- | --- | --- |
| `@electric-sql/pglite` `^0.5.15` | `src/lib/db.ts` | `new PGlite("idb://rp-studio")`、`waitReady` | `getDb()` 单例 + `readyPromise` 去重；`MIGRATIONS` 逐条在 `db.transaction` 内执行并写 `schema_meta.version`；`resetDatabase()` drop 全部表后重建 |
| 原生 SQL / jsonb | `src/lib/repo.ts` | 角色 / 会话 / 消息 / 设置 CRUD、导入导出、统计 | 行映射统一处理 `snake_case → camelCase` 与 `Date → ISO`；`jsonb` 一律 `JSON.stringify` + `::jsonb` 强转；`listSessions` 用子查询算 `message_count` 并 `pinned desc, updated_at desc` 排序；`importAll` 在单事务内先清四表再回灌 |
| `zustand` `^5.1.0` | `src/lib/store.ts` | 全局状态与全部 action | 模块级 `initStarted` 防重复初始化、`abortController` 支持停止生成；`navigator.storage.persist()` 申请持久化；流式只在内存累积，结束才落库 |
| `src/lib/types.ts` | — | 领域类型单一事实来源 | `ChatMessage`（只有 role/content）与 `Message`（DB 行，含 status/meta）严格区分 |
| `src/data/seed.ts` | — | 首次启动的三个示例角色 | 含示例工作流与脚本；`greeting` 里带 `{{user}}` |

### 2.3 模型与编排

| 技术 / API | 入口文件 | 职责 | 关键决策 |
| --- | --- | --- | --- |
| `fetch` + `ReadableStream` | `src/lib/llm.ts` | OpenAI 兼容请求、SSE 手解、中止、错误归类 | **不是 `EventSource`**；`buildBody` 里 `{ ...extra, model, messages, stream }` 核心字段在后，防止 `params` 误写覆盖；是否流式看响应 `content-type` 含不含 `event-stream`，否则回退 `res.json()`；按空行分帧、`parts.pop()` 留半包；错误体最多取 300 字 |
| URL 规范化 | `src/lib/settings.ts` | `normalizeBaseUrl` / `completionsUrl` | 补 `https://`、去尾斜杠；用户若已粘贴完整 `/chat/completions` 不再重复拼接；额外参数以 JSON 文本原样透传 |
| 上下文装配 | `src/lib/context.ts` | 有序块 → messages、负数下标切片、变量插值、trace、token 估算 | 连续 `system` 合并成一条；无 `user` 块时自动在末尾补输入；`interpolate` 支持 `{{char}} {{user}} {{input}} {{time}} {{history}}`，`time` 缺省取本地时间 |
| DFS 执行器 | `src/lib/workflow.ts` | 节点构造、默认图、校验、执行 | 每个分支复制消息栈互不污染；`depth > 32` 判环；`llm` 节点参数与全局参数浅合并、节点优先；`{{nodeId.output}}` 引用前序节点输出；无输出节点时退化为 `Object.values(outputs).pop()` |
| Web Worker 沙箱 | `src/lib/script.ts` + `src/lib/script-worker.ts` | `AsyncFunction` 执行用户 JS、超时熔断、日志回传 | Vite 的 `?worker` 导入；**每次执行新建 Worker 并 `terminate()`**；主线程计时 `Math.max(200, timeoutMs)`；`settled` 防重复 resolve；返回值归一化为 `string` 或 `{ text, messages }` |
| `marked` `^18.1.3` + `dompurify` `^3.4.17` | `src/components/chat/Markdown.tsx` | Markdown 渲染与消毒 | `marked.parse(content, { async: false })`；`DOMPurify.sanitize(..., { ADD_ATTR: ["target"], FORBID_TAGS: ["style","form","input"] })`；解析异常时转义原文兜底 |

### 2.4 样式与视觉（设计描述见第 5 章）

| 技术 / API | 入口文件 | 职责 |
| --- | --- | --- |
| CSS 变量 + `color-mix(in oklab, …)` + `@theme inline` | `src/index.css` | 单 `--accent` 派生整套 Material 3 色板、亮暗主题、9 组强调色、shadcn 令牌兼容层、`.md` 排版、关键帧 |
| 内联同步脚本 + `matchMedia` | `index.html`、`src/lib/theme.ts` | 首屏前恢复主题防闪烁、跟随系统、更新 `meta[theme-color]` |
| `motion` `^14.10.1`（`motion/react`） | `src/components/ui/*` | `AnimatePresence`、spring、`layoutId` 下划线、抽屉与 Toast 动效 |
| `ResizeObserver` + `mask-image` | `src/components/chat/Composer.tsx`、`MessageList.tsx` | 悬浮输入层高度上报与消息区淡出，靠同一个 `bottomInset` 联动 |
| Pointer Events + SVG 贝塞尔 | `src/components/workflow/WorkflowEditor.tsx` | 画布平移、指针锚点缩放、拖拽连线、适应画布 |

### 2.5 UI 组件与交互

| 组件 | 文件 | 要点 |
| --- | --- | --- |
| 基础件 | `src/components/ui/{Button,Form,Tabs,Drawer,Toasts}.tsx` | `cn()`（`clsx` + `tailwind-merge`）；Drawer 有 `role="dialog"` / `aria-modal` / Esc / Tab 边界回绕 / 打开时自动聚焦；`IconButton` 统一写 `aria-label` + `title` |
| 抽屉 | `src/components/drawers/{LeftDrawer,SettingsDrawer,CharacterDrawer}.tsx` | 三个抽屉由 `store.drawer` 互斥；模型配置与角色卡都是**本地草稿**，点保存才落库；测试连接刻意用 `max_tokens: 24 + stream: false` 绕开用户参数 |
| 聊天 | `src/components/chat/{ChatView,ChatHeader,MessageList,MessageItem,Composer,Markdown}.tsx` | 消息操作（复制 / 编辑重发 / 重新生成 / 删除）；开场白消息屏蔽「重新生成」但保留复制删除；IME 保护 |
| 编辑面板 | `src/components/character/ContextEditor.tsx`、`src/components/script/ScriptEditor.tsx`、`src/components/workflow/WorkflowEditor.tsx` | 原生 HTML5 拖拽排序 + 上下移按钮；脚本编辑器支持 Tab 插空格；工作流画布试运行不写库 |
| 兜底 | `src/components/ErrorBoundary.tsx`、`src/components/home/Backdrop.tsx` | class 组件 `getDerivedStateFromError`；背景层固定 `-z-10` 且 `aria-hidden` |
| 图标 | `lucide-react` `^1.70.0` | 全局图标来源 |

---

## 3. 源码地图

```text
RP-Studio/
├─ README.md                    # 技术栈索引 / 规范 / 界面设计描述
├─ index.html                   # 首屏主题恢复，避免闪烁
├─ package.json
├─ vite.config.ts               # React + Tailwind v4；@ 别名；PGlite 排除预构建
├─ components.json              # shadcn CLI 配置（new-york / Tailwind v4）
├─ tsconfig.json
├─ wrangler.jsonc               # Workers 静态资源 + SPA 回退
├─ pnpm-workspace.yaml          # allowBuilds: esbuild / workerd
├─ .npmrc                       # 国内 npm 镜像
├─ public/favicon.svg
├─ docs/                        # 界面截图
└─ src/
   ├─ main.tsx                  # 入口：并行启动 DB + 挂载 App（App 内有启动/错误态）
   ├─ App.tsx                   # 背景层 + 940px 内容列 + 抽屉编排 + 主题监听
   ├─ index.css                 # 设计令牌、全局样式、Markdown 排版、关键帧
   ├─ lib/
   │  ├─ types.ts               # 领域类型：Character / Session / Message / ContextBlock / Workflow
   │  ├─ db.ts                  # PGlite 实例、建表、版本化迁移、重置
   │  ├─ repo.ts                # 仓储：CRUD / 导入导出 / 统计 / 消息截断
   │  ├─ store.ts               # zustand：数据流、发送与重新生成、流式状态、抽屉、Toast
   │  ├─ settings.ts            # 默认模型配置、URL 规范化
   │  ├─ context.ts             # 上下文装配引擎（排序 / 负数下标 / role 合并 / 插值）
   │  ├─ llm.ts                 # OpenAI 兼容请求、SSE 解析、中止、错误归类
   │  ├─ script.ts              # Worker 沙箱调用封装（超时、日志、结果）
   │  ├─ script-worker.ts       # Worker 内：AsyncFunction 执行用户脚本
   │  ├─ workflow.ts            # 节点构造、默认图、校验、DFS 执行器
   │  ├─ theme.ts               # 强调色预设、亮暗应用、跟随系统
   │  └─ utils.ts               # cn / uid / 时间 / 剪贴板 / JSON / token 估算 / 下载
   ├─ components/
   │  ├─ ErrorBoundary.tsx
   │  ├─ ui/                    # Button / Form / Drawer / Tabs / Toasts
   │  ├─ home/Backdrop.tsx      # 光斑漂移 + 网格遮罩
   │  ├─ chat/                  # ChatView / Header / MessageList / MessageItem / Markdown / Composer
   │  ├─ drawers/               # LeftDrawer / SettingsDrawer / CharacterDrawer
   │  ├─ character/ContextEditor.tsx
   │  ├─ script/ScriptEditor.tsx
   │  └─ workflow/WorkflowEditor.tsx
   └─ data/seed.ts              # 首次启动的三个示例角色
```

---

## 4. 领域规范

### 4.1 数据模型（PGlite）

```sql
characters(
  id uuid pk, name text, avatar text, tagline text, description text,
  greeting text, system_prompt text, context_blocks jsonb, quick_phrases jsonb,
  workflow jsonb, script text, model_override jsonb,
  created_at timestamptz, updated_at timestamptz
)

sessions(
  id uuid pk, character_id uuid references characters(id) on delete cascade,
  title text, pinned boolean default false,
  created_at timestamptz, updated_at timestamptz
)

messages(
  id uuid pk, session_id uuid references sessions(id) on delete cascade,
  role text check (role in ('system','user','assistant')),
  content text, status text, meta jsonb,
  created_at timestamptz
)

settings(key text pk, value jsonb)
schema_meta(id int pk, version int)
```

- **迁移**：`db.ts` 的 `MIGRATIONS` 数组按 version 逐条执行（v1 建四表 + 两个索引，v2 补 `characters.greeting`），在事务内更新 `schema_meta`，升级不丢数据。
- **ID**：浏览器 `crypto.randomUUID()` 生成，不依赖 Postgres 扩展；`uid(prefix)` 加前缀。
- **写入策略**：流式过程只在内存累积，结束后一次性落库；停止 / 出错也保存已生成部分。
- **初始消息**：角色的 `greeting` 在**新建会话**时插值后作为一条 `assistant` 消息写入（`meta.greeting = true`，界面显示「开场」）。因此它天然进入历史、能被历史块取到，也能像普通消息一样复制 / 删除；留空则新会话显示角色介绍空态，**已存在的会话不会被补写**。

![角色卡初始消息](docs/greeting.png)

### 4.2 上下文编排规范

角色卡的 `contextBlocks` 是**有序数组**，顺序即最终 messages 顺序。

```ts
type ContextBlock =
  | { id: string; kind: "system"; enabled: boolean; label?: string }
  | { id: string; kind: "history"; enabled: boolean; from: number; to: number; label?: string }
  | { id: string; kind: "custom"; enabled: boolean; role: "system" | "user" | "assistant"; content: string; label?: string }
  | { id: string; kind: "user"; enabled: boolean; label?: string };
```

- **负数下标**：`from = -5, to = -1` 取倒数第 5 条到倒数第 1 条；`0 → -1` 取全部。越界自动裁剪到 `[0, n-1]`，正数按 0 基绝对下标处理，`from > to` 自动交换。
- **装配顺序**：逐块产出消息 → 连续 `system` 用 `\n\n` 合并为一条（兼容严格接口）→ 没有启用的 `user` 块时自动在末尾补当前输入。
- **变量**：`interpolate()` 支持 `{{char}}` `{{user}}` `{{input}}` `{{time}}` `{{history}}`。注意 **system 块只注入 `char` / `user`**，所以在系统提示里写 `{{input}}` 会得到空串；`{{input}}` 与 `{{history}}` 实际用于自定义块与工作流模板。
- **预览**：上下文页可展开「装配预览」，显示每条消息、每块贡献说明（trace）与粗估 token（CJK 每字 1 token、其余每 4 字符 1 token，每条消息 +4）。
- **编辑**：原生 HTML5 拖拽排序 + 上移 / 下移按钮（键盘可达）；`onDragOver` 必须 `preventDefault()` 才会触发 drop。

### 4.3 工作流规范

| 节点 | 作用 | 关键配置 |
| --- | --- | --- |
| `input` | 起点：注入上下文装配结果 + 用户输入 | — |
| `template` | 文本模板注入，支持 `{{input}} {{char}} {{user}} {{history}} {{time}}` 与 `{{nodeId.output}}` | `role`、`append` / `replace` |
| `script` | 沙箱执行 JS，可重写 `ctx.messages` | `code` |
| `llm` | 调用模型，参数与全局浅合并（节点优先） | `params`(JSON)、`persist` |
| `output` | 汇总最终回复 | — |

- **执行**：从 `input` 出发按出边深度优先遍历；每条分支复制消息栈互不污染；`depth > 32` 判定可能存在环并中止该分支。
- **校验**：缺 `input`、缺 `output`、无连线、存在指向已删除节点的悬空边，四类错误。
- **端口与画布**：右侧圆点拖出连线，松开在目标节点 / 左侧输入圆点上完成（用 `document.elementFromPoint` + `closest("[data-node-id]")`）；`Delete` 删除选中节点，输入框聚焦时不生效。
- **试运行**：不写库，直接在当前会话上下文上跑一遍，底部面板输出逐节点日志、耗时、字数与最终文本。
- **默认关闭**：在角色卡「工作流」页开启后，聊天回复走编排，消息带「工作流」标记并可展开执行日志。

### 4.4 脚本沙箱

用户脚本在独立 **Web Worker** 中执行（每次运行新建，互不共享全局状态），主线程计时，超时 `terminate()`。

```js
// 可用：ctx.messages / ctx.input / ctx.vars / ctx.character / ctx.history
// 辅助：log() / warn() / error()
// 返回：string | { text: string, messages?: ChatMessage[] }

log("上下文消息数:", ctx.messages.length);
const last = [...ctx.messages].reverse().find((m) => m.role === "user");
ctx.messages.push({ role: "system", content: "写作提示：留白。" });
return { text: "已注入提示", messages: ctx.messages };
```

- 角色卡「脚本」页 = **前置脚本**：每次生成前执行；仅当返回 `messages` 非空时才替换实际请求的消息栈。当前实现未把前置脚本日志接到 UI。
- 工作流「脚本」节点 = 编排内执行，日志会进入节点日志，只影响后续节点。
- 沙箱**不是权限隔离**：Worker 内仍可访问 `fetch` 等全局能力，超时只是兜底。

---

## 5. 界面与交互 · 自然语言提示词

> 这里写的是设计意图，不是技术规格。不列像素值，也不列类名和公式——布局关系、交互反馈、视觉观感说清楚了，具体怎么落笔交给编码助手自己把握。整段复制就能投喂，也可以只取一段来重做某个局部。第 2 章负责查「哪个文件、哪个依赖」，这一章只回答「它看起来什么样、用起来什么感觉」。

### 整体印象与页面骨架

```text
请做一个安静、留白充足的对话工作台。它不是那种布满卡片和边框的仪表盘：整个页面只有一条居中的、宽度适合阅读的内容列，左右留出大片呼吸空间，列的两侧用极淡的边界把内容从背景里轻轻托起来。

页面分两层。底下一层是环境，固定不动、不参与滚动、不拦截鼠标，只是让空白区域不至于死板；上面一层是内容，承担所有信息和操作。设置、角色卡、会话列表这些东西不要挤进内容列，而是从侧边滑出来的面板，用完就走，不常驻在画面里。

数据还没准备好、或者加载失败的时候，也要维持同样的气质：给一句温和的说明和一个明确的出口，不要露出浏览器默认的错误或一片空白。

动效只用来交代层级关系——面板从侧面进来、消息轻轻浮起、状态切换有个柔和的过渡。除此之外界面应该是静止的，不要到处晃、到处弹。
```

### 色彩与主题

```text
请把颜色体系做成「一个主色，加上一整套由它生长出来的层次」。基调是偏暖的灰白，正文是接近黑的深灰，不要用纯白和纯黑制造生硬对比；卡片、抽屉、输入框靠几档深浅非常接近的表面色区分层级，边框只留极淡的一笔，阴影用来表示浮起，而不是描轮廓。

只定义一个品牌强调色。按钮、选中态、用户气泡、焦点圈、背景光晕、工作流连线都从这一个颜色派生，深浅和透明感交给色彩混合去算，不要为每处单独写死色值，更不要把颜色散落到组件代码里。这样做的结果是：换掉根上的那个颜色，整页会一起换气质，而不是这里变了那里没变。

提供浅色、深色以及跟随系统的模式，再配一组风格统一的候选强调色。深色不是把浅色反转过来，而是让表面沉下去、文字浮起来，同时把强调色提亮，保证它在暗背景上依然清楚。切换要即时、不刷新、不闪烁——包括刚打开页面、脚本还没跑起来的那一瞬间，也应该是正确的颜色。选中的模式要能被记住。

如果之后要接入按组件分发的 UI 库，请把它的颜色语义映射到这套体系上，注意别让它的「强调色」和品牌色抢同一个名字。
```

### 背景与内容列

```text
请让背景成为一种几乎察觉不到的氛围。几团非常柔和的光斑缓慢地在页面两端漂移，彼此节奏不同、永远不同步；再铺一层极淡的网格，越往边缘越淡，最后完全消失。光斑和网格都要从主题色和文字色里调出来，深色模式下自动收敛，不能变成抢眼的色块。

内容列是半透明的，带一点毛玻璃感，能隐约透出背后的光晕，但文字始终清晰。桌面宽度收到一个适合长时间阅读的尺度，窄屏时自然铺满。列内的消息区域自己滚动，背景完全不动。

背景层不能产生滚动条，不能挡住任何点击，也不能被内容列的底色完全盖死——两者之间要有一点若隐若现的层次。
```

### 基础控件与动效

```text
请做一套克制的控件：按钮、输入框、下拉、开关、滑块、分段选择、侧滑面板和轻提示。它们共享同一种圆润的几何语言、同一种焦点表现，以及按下时轻微收缩的反馈。

输入框和开关在获得焦点时才浮出一圈很柔的光；开关的滑块滑动要有弹性但不拖沓；滑块用主题色表示已经选中的那一段。分段选择的下划线应该平滑地滑到新位置，而不是瞬间跳过去；同一页面上出现多组分段选择时，各自的动画互不干扰。

侧滑面板从边缘推入，背后压一层暗色遮罩。打开时焦点自动落到面板里，键盘的 Tab 只在面板内循环，Esc 或点击遮罩即可关闭，关闭之后页面滚动要恢复到打开前的状态。轻提示从上方轻轻落下，短暂停留后自己消失，不打断当前操作。

动效的基调是柔和、略带回弹，只用在状态变化的地方；系统偏好减少动态效果时，界面应当安静下来。
```

### 消息与正文

```text
请把两种消息做成明显不对称的观感：角色的回复不加气泡、不加底色，像正文一样自然铺在内容列里，Markdown 排版要舒展，代码块、引用和列表各有分寸；用户的发言则收进一枚右对齐的浅色气泡，圆角柔和，靠近发送方向的那一个角收得更紧，颜色从主题色里轻轻带出来。

消息悬停时才浮出复制、编辑、重新生成、删除这些操作；键盘聚焦时也必须能出现，不能只伺候鼠标。流式输出时末尾跟一枚细微的光标，等待回复时用几个依次起伏的小圆点。复制成功给一个短暂的图标反馈就够了。开场白、工作流回复、已编辑这类状态用很小的文字带过，不要做成显眼的徽章。

用户输入的正文当纯文本看待，角色回复再做 Markdown 渲染并消毒——模型输出属于不可信内容，这一步不能省。
```

### 悬浮输入层

![悬浮输入层与淡出](docs/composer-fade.png)

```text
这是最需要拿捏的一块，请仔细读。

输入框要浮在消息列表之上，而不是排在它下面占据布局。消息一直延伸到输入框背后，滚动到最下方时，最后几条自然地淡出、融进背景；淡出的是消息自己的绘制，不是在上面盖一层颜色。这一点很关键：如果在输入框上方铺一条实色渐变，换成深色主题或换过强调色之后，输入框左右两侧就会露出一条和页面不同色的横条，非常显眼。正确做法是让淡出区域保持完全透明，输入框两侧始终透出页面原本的底色。

输入框会随着内容变高：换行、快捷语行出现或消失，都要让消息列表同步让出空间，最后一条消息永远完整可见，不会被浮层压住。「回到最新消息」按钮也要跟着一起上移，而不是钉死在屏幕某个位置。用户停留在底部时，新内容自动把视图带下去；一旦主动往上翻，就不要再打扰他。

输入体验要照顾中文：输入法组词过程中的回车不能误触发发送，换行交给组合键。快捷语点一下就补进输入框并保持焦点。生成过程中，输入区要给出一个明确的「可以停止」的出口。
```

### 工作流画布

```text
请做一张可以自由摆布的节点画布，观感像一张铺开的桌面，而不是一张表单。底色是很淡的点阵网格，网格跟着画布一起平移和缩放，始终和节点对齐。

节点是能随手拖着走的卡片，用颜色区分类型；从右侧的小圆点拉出一条柔和的曲线连到另一个节点左侧，松手落在卡片上、或者落在输入端口上都能完成连接。连线用主题色，拖的过程中有一条跟随鼠标的虚线作预览。起点节点没有入口、终点节点没有出口，别画多余的端口。

滚轮缩放要以鼠标所在的位置为锚点：光标压在哪个节点上，缩放后那个节点还应该在光标下面，不能漂走。缩到很小之后再拖节点，位移仍然跟手。空白区域拖拽用来平移整张画布，点在节点上时不要误触发平移。提供一个「适应画布」的动作，把所有节点舒服地收进视野；重置视图能回到最初的状态。

选中节点后可以按删除键把它和相连的线一起移除；但如果此刻正在输入文字，删除键应该只删文字。Escape 优先用来取消正在拉的那条连线。
```

### 响应式、无障碍与安静模式

```text
最后请把这些当成贯穿全局的常识，而不是附加功能。

窄屏时内容列自然铺满，侧滑面板几乎占满屏宽，顶栏只保留最必要的信息；消息左右留白收窄，但依然透气。桌面则维持一个适合阅读的宽度，气泡不要顶到边缘。

所有只有图标的按钮都要能被读屏软件念出用途；面板打开时焦点要进去、关闭时要回到原来的地方；开关、标签页、等待提示都要有可被识别的状态。纯装饰的背景层对辅助技术完全不可见。键盘焦点必须有清楚可见的轮廓，不能为了好看把它抹掉。

系统开启「减少动态效果」时，界面里的过渡和循环动画应当停下来。注意由动画库驱动的弹性动效和纯 CSS 动画是两套机制，别只处理其中一套就宣称已经全局生效；如果暂时做不到，就如实说明。
```

---

## 6. 开发与部署

```bash
pnpm build       # tsc --noEmit && vite build
pnpm deploy      # vite build && wrangler deploy（先 wrangler login）
```

`wrangler.jsonc` 使用 `assets.directory: ./dist` + `not_found_handling: "single-page-application"`，`run_worker_first: false`，无需任何服务端代码。也可直接托管到 Pages / Vercel / Netlify —— PGlite 只在浏览器运行。首次打开需要下载 PGlite 的 WASM（约 3 MB，gzip 后），之后由浏览器缓存。

### 追加 shadcn/ui 组件

`shadcn` CLI 已作为 devDependency 安装，`components.json` 指向 Tailwind v4 与 `src/index.css`：

```bash
pnpm exec shadcn add dialog
# 或
pnpm dlx shadcn@latest add tooltip
```

生成的组件写入 `src/components/ui/`，通过 `@/lib/utils` 复用 `cn()`。`src/index.css` 已把 `background / foreground / card / muted / primary-foreground / destructive / input` 等 shadcn 令牌映射到 Material 变量；品牌强调色与 shadcn 的 `accent` 语义刻意分开：`--color-accent` 指向 `--accent-soft`（`--secondary-container`），而 `--accent` 始终专指品牌色。

> 两个已知缺口：映射表里**没有** `--color-ring` 和 `--color-border`（本项目用裸变量 `--ring` 与自定义名 `--color-line`）。因此用 CLI 追加的组件若写了 `ring-ring` / `border-border` 会拿不到令牌，需要手动换成 `focus:ring-[var(--ring)]/15` / `border-line`。另外不需要再执行 `shadcn init`，它会覆盖现有主题变量。

---

## 7. 设计基调与已知限制

这里只留两件事：几句贯穿全局的取舍，以及当前实现里值得留意的边界。界面具体长什么样、怎么交互，都写在第 5 章了。

**设计基调**

整站的观感建立在「一个强调色生长出所有层次」之上。换主题时是整页一起变，而不是逐处调色；层级靠几档非常接近的表面色拉开，边框和阴影都很轻，动效只用来交代层级变化。消息区与输入层是浮层关系，不是上下排列，所以淡出必须由内容自己完成，不能靠叠一层颜色去遮——这是最容易将就、也最容易露馅的地方。

**已知限制**

- PGlite 运行在主线程，数万条消息的查询会有短暂卡顿；单用户本地库，未做分页虚拟列表。
- 同一浏览器的多个标签页共用一个 IndexedDB，极端并发写入可能互相覆盖（无 BroadcastChannel 同步）。
- API Key 明文存在本地 IndexedDB；跨域调用依赖模型服务商的 CORS 支持。
- 工作流是「可编排的有向图 + 顺序 DFS 遍历」，不是图灵完备调度器；无重试 / 定时 / 并行节点。
- 脚本沙箱不是权限隔离，Worker 内仍可 `fetch`；超时是兜底。
- Markdown 消毒放行了 `target` 属性但未强制 `rel="noopener noreferrer"`。
- shadcn 令牌映射缺 `--color-ring` / `--color-border`，见第 6 章说明。

---

## License

见 [LICENSE](./LICENSE)。
