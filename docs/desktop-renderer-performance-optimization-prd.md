# Desktop 渲染进程性能优化 PRD

> 状态：**待评审（尚未实施；本文档只定义交付合同）**
> 目标版本：`@downcity/desktop` 0.1.0（Electron 40.10.6 / React 19.2.6 / Vite 7.1.6）
> 关联代码：`app/desktop/`
> 实测基线：2026-09-21，渲染进程 RSS 约 1.8 GB，主进程约 538 MB，应用合计约 2.4 GB

---

## 一、结论摘要

### 1.1 现状

当前 Desktop 渲染进程（Electron Helper Renderer）常驻内存约 **1.8 GB**，主进程约 **538 MB**。经实测与代码审查，根因不是单个泄漏，而是四类结构性问题叠加：

| 编号 | 问题 | 证据 | 量级 |
|---|---|---|---|
| P1 | 渲染 bundle 严重超重 | `out/renderer/assets/index-*.js` 主包 **6.0 MB**，渲染资源共 **351 个 chunk / 19.5 MB**（mermaid 全家 + shiki 全部语言 + cytoscape + wasm） | 高 |
| P2 | 消息列表不虚拟化、离屏 DOM 永不回收 | `ChatMessageViewportRow.tsx` 明确禁止 `content-visibility`；`ProgressiveMessageSegments` 每 24ms 挂载一段但永不卸载 | 高 |
| P3 | 高亮/图表等重计算在渲染主线程同步执行 | `workspace_code_highlighter.ts` 在 `useEffect` 内直接调用 shiki；`render_mermaid.ts` 静态引入 mermaid 到主包 | 中 |
| P4 | Main 进程持有全部会话模型 + IPC 全量快照 | `AgentController.get_chat_snapshot` 一次传整页消息；main + renderer 双份数据 | 中 |

### 1.2 本次要做的事

1. **Bundle 瘦身**：把 mermaid 核心与全部图类型改为真正按需加载；裁剪 shiki 语言包；移除 `optimizeDeps.include: ["mermaid"]` 对主包的污染；用 `manualChunks` 拆分 vendor。
2. **长会话 DOM 回收**：为消息列表引入窗口化渲染（虚拟滚动），离屏消息只保留占位高度，进入视口才挂载真实内容；保留滚动位置与文本选择语义。
3. **重计算离屏化**：shiki 高亮迁移到 Web Worker；mermaid 渲染保持串行队列但改为动态导入并增加渲染上限保护。
4. **数据面瘦身**：会话 snapshot 分页/按需传输；Main 进程对非活跃 Session 释放订阅与模型缓存。
5. **观测与回归**：新增内存/包体预算测试，防止回归。

### 1.3 本次明确不做的事

| 不做 | 原因 |
| --- | --- |
| 重构 Main 进程为独立渲染沙箱 / 把 Agent 挪到子进程 | 改变执行模型，风险高、收益不确定，超出本次范围 |
| 数据库/存储层优化 | Session 存储已在 `docs/session-sqlite-storage-redesign-prd.md` 单独规划 |
| 消息模型（SessionMessage）schema 变更 | 属于另一个 PRD 的范畴，本次只动渲染层 |
| 富文本编辑器（tiptap）替换 | 编辑器只在 composer 使用，先确认按需加载，不替换 |
| 主题/视觉重构 | 与性能无关 |
| 移动端 / 触屏布局 | Desktop 是 Electron 桌面应用 |

### 1.4 关键决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 消息列表窗口化方案 | 自研轻量虚拟列表（不引入 `react-window`/`@tanstack/react-virtual`），基于 `data-chat-viewport-row` 行高估算 + IntersectionObserver | 现有代码已按行划分 DOM（`ChatMessageViewportRow`），行高差异大（代码块/图表/纯文本相差一个数量级），需要按内容缓存行高；通用库难以满足"保留完整文本选择语义"约束。替代方案见 11.4 |
| mermaid 按需加载 | `render_mermaid.ts` 改为 `const { default: mermaid } = await import("mermaid")`，配合 Vite 动态拆分 | 当前 `import mermaid from "mermaid"` 静态引入被 `optimizeDeps.include` 提前预构建进主包 |
| shiki 语言包 | 保留高频语言内联，其余保持按需 `import()`；新增"首次遇到该类型才加载"的缓存已有，重点是把构建产物裁剪掉不需要的语言 | `language_loaders` 已有按需机制，但产物里仍出现全部语言 chunk，说明构建图未裁剪 |
| 高亮线程 | shiki 高亮迁移到 Web Worker | 高亮 400k 字符上限内的文件仍可能阻塞主线程数百 ms；Worker 隔离后 UI 不卡顿 |
| 数据分页 | 会话 snapshot 只传当前视口附近消息 + 分页加载 | `get_chat_snapshot` 当前一次传整页（`session.messages()` 全部 items），长会话 IPC 传输与内存双高 |
| 观测 | 新增 `docs/desktop-performance-budget.md` 预算表 + 单元测试断言 | 防止 bundle/内存回归 |

---

## 二、背景

### 2.1 为什么现在做

Desktop 处于 0.1.0 快速迭代期，功能面在扩大（Agent / Group / Workspace / Power / 通知 / 命令面板），但渲染层性能没有专门治理。实测 1.8 GB 的渲染进程在 24 GB 内存机器上已占 7.2% 内存 + 高 CPU，会：

- 拖慢整个应用的响应（滚动、输入、切换 Session）；
- 与 Chrome / VS Code / 虚拟机争抢内存，触发系统 swap（当前 swap 已用 92%）；
- 影响用户对"桌面客户端"的第一印象——一个聊天应用不该比 IDE 还重。

### 2.2 现状代码结构（与本次相关的部分）

```text
app/desktop/src/renderer/
  main.tsx                                  入口（StrictMode + MotionConfig）
  app/DesktopShell.tsx                      壳层：侧栏 + BayBar + 命令面板
  lib/store.ts                              use_store / use_store_selector（useSyncExternalStore 基元）
  features/chat/
    components/SessionMessageList.tsx       消息分段投影 + ProgressiveMessageSegments
    components/ChatMessageViewportRow.tsx   消息行容器（明确禁止 content-visibility）
    components/messages/*.tsx               单条消息渲染（AgentMessage / UserMessage / Markdown / Mermaid）
    lib/chat_render_cache.ts                会话级渲染缓存 LRU（默认保留 8 个）
    state/use_chat_stream_store.ts          高频消息/runtime store
  components/markdown/
    Markdown.tsx                            Streamdown 封装
    mermaid/MermaidDiagram.tsx              懒渲染 + 串行队列
    mermaid/render_mermaid.ts               静态 import mermaid
  lib/workspace/workspace_code_highlighter.ts  shiki 高亮（主线程）
```

### 2.3 已做对的部分（保留）

- 7 个 domain store + `useSyncExternalStore` 细粒度订阅（见 `docs/desktop-state-performance-redesign.md`），高频更新已按领域隔离；
- 会话级渲染缓存 LRU（`chat_render_cache.ts`）已存在，但只淘汰"渲染缓存"，不淘汰 DOM；
- mermaid 懒渲染（IntersectionObserver + 320px 提前量）与串行渲染队列已实现；
- Markdown 有 128KB / 行 64KB 的上限保护（`markdown_render_limits.ts`）；
- shiki 已做 400k 字符上限与语言按需加载；
- workspace 文件预览有 2MB 上限；
- 消息分段渐进挂载（每 24ms 一段）避免首屏一次性卡死。

---

## 三、目标与非目标

### 3.1 目标（可量化）

| 指标 | 当前 | 目标 | 验证方式 |
|---|---|---|---|
| 渲染进程峰值 RSS（空会话 + 侧栏） | ~800 MB（估） | **≤ 450 MB** | 启动后 `ps` / 性能面板 |
| 渲染进程峰值 RSS（1000 条消息长会话） | ~1.8 GB（实测） | **≤ 900 MB** | 构造 1000 条消息会话后测量 |
| 主 bundle 体积（gzip） | 6.0 MB（未压缩） | **≤ 3 MB**（未压缩） | `pnpm build` + 产物统计 |
| 渲染资源总大小 | 19.5 MB | **≤ 10 MB** | `pnpm build` + 产物统计 |
| 消息列表滚动帧率（长会话） | 卡顿（估） | **≥ 55 fps** | DevTools Performance 录制 |
| 打开 500 条消息会话的 TTI | 慢（估） | **≤ 1.5 s** | Performance 面板 |

> 注：`当前`列中标注"估"的为代码审查推断，正式基线应在实施第一步建立（见 8.1）。

### 3.2 非目标

- 不追求把渲染进程压到 200MB 以下的极限优化；
- 不做磁盘缓存 / 持久化层优化；
- 不改变 IPC 协议语义（新增分页参数除外）；
- 不牺牲正确性（文本选择、滚动恢复、历史前插、流式更新）来换性能。

---

## 四、现状诊断

### 4.1 P1：渲染 Bundle 严重超重

**实测产物（`app/desktop/out/renderer/assets/`）：**

| 产物 | 大小 | 内容 |
|---|---|---|
| `index-*.js`（主包） | **6.0 MB** | React + Streamdown + mermaid 核心 + shiki 核心 + katex + tiptap + framer-motion + 业务代码 |
| `wardley-*.js` | 1.2 MB | mermaid wardley 图 |
| `cytoscape.esm-*.js` | 934 KB | mermaid 依赖 cytoscape |
| `emacs-lisp-*.js` | 762 KB | shiki emacs-lisp 语法 |
| `cpp-*.js` / `wasm-*.js` / `architectureDiagram-*.js` 等 | 数百 KB 各 | shiki 语言包 + mermaid 图类型 |
| **合计 351 个 chunk** | **19.5 MB** | 全部渲染资源 |

**根因：**

1. `electron.vite.config.ts` 里 `optimizeDeps: { include: ["mermaid"] }` 让 mermaid 在**启动阶段**完整预构建；
2. `render_mermaid.ts` 顶部 `import mermaid from "mermaid"` 是**静态导入**，把 mermaid 核心拉进主包依赖图；
3. mermaid 自带全部图类型动态 chunk（wardley / architecture / sequence / gantt / venn / quadrant / timeline / xychart / c4 / flow / er / gitGraph / dagre / cytoscape / cose-bilkent / layout...），Vite 在 build 时全部产出；
4. `workspace_code_highlighter.ts` 的 `language_loaders` 声明了 **40+ 种语言**，虽然运行时按需 `import()`，但构建图把所有语言 chunk 都保留在产物里。

**影响：** 渲染进程启动解析 6 MB JS，V8 编译 + 模块驻留 + 正则引擎 + sourcemap 引用，保守估算吃掉 300–500 MB 内存；长会话场景更放大。

### 4.2 P2：消息列表不虚拟化，离屏 DOM 永不回收

代码路径：`features/chat/components/SessionMessageList.tsx` + `ChatMessageViewportRow.tsx`。

- `ProgressiveMessageSegments` 只是**渐进挂载**（每 24ms 往前补一段），一旦挂载就**永远留在 DOM 树**；
- `ChatMessageViewportRow.tsx` 明确注释"这里【不要】加 `content-visibility`"，理由是行高差异大、占位高度会造成内容跳动；
- 每条消息包含：完整 Markdown DOM 子树、React Fiber 节点、shiki token 数组、可能的 mermaid SVG。

**影响：** 会话消息数线性增长，DOM 节点 + React 状态 + 高亮 token 数组随之线性增长且**永不回收**。这是长会话后内存爬到 1.8 GB 的主因。

### 4.3 P3：高亮 / 图表等重计算在渲染主线程同步执行

- `workspace_code_highlighter.ts` 在 `useEffect` 里直接调用 `highlight_code_lines`（shiki JS 正则引擎），400k 字符上限内的文件也可能阻塞主线程数百 ms；
- `render_mermaid.ts` 的串行渲染队列正确，但 mermaid 本身重（cytoscape、dagre 布局），渲染期间主线程仍被占用。

### 4.4 P4：Main 进程持有全部会话模型 + IPC 全量快照

- `AgentController` 在 main 进程直接 `new City(...)`，持有全部 Agent / Session / Power；
- `get_chat_snapshot` 一次 `session.messages()` 拿整页消息，经 IPC 全量序列化给渲染进程；
- main + renderer 双份消息数据，内存翻倍。

### 4.5 内存构成估算（1.8 GB）

| 项目 | 估算 |
|---|---|
| Chromium 渲染器基础（GPU、合成器、V8 isolate） | 350–450 MB |
| 6 MB JS 解析 + V8 heap + 模块运行时 | 300–500 MB |
| mermaid / shiki / katex / tiptap 运行时数据结构 | 200–400 MB |
| 消息 DOM 树 + React Fiber（长会话） | 300–600 MB |
| dev 模式额外开销（sourcemap、HMR、devtools） | 100–200 MB |

---

## 五、方案设计

### 5.1 Bundle 瘦身

#### 5.1.1 mermaid 动态化

**改动文件：** `src/renderer/components/markdown/mermaid/render_mermaid.ts`、`electron.vite.config.ts`

```ts
// render_mermaid.ts 顶部：静态导入改为动态
// 之前：import mermaid from "mermaid";
// 之后：mermaid 只在使用时加载
let mermaid_promise: Promise<typeof import("mermaid")> | undefined;
function get_mermaid() {
  mermaid_promise ??= import("mermaid");
  return mermaid_promise;
}
```

- 移除 `electron.vite.config.ts` 中 `optimizeDeps: { include: ["mermaid"] }`（如保留则 dev 下仍预构建进主包）；
- 保留现有串行队列与稳定 id 逻辑；
- 增加**单会话渲染上限**：同一 Session 内已渲染图表数量达到阈值（如 20）后，后续图表只显示占位与"渲染超出上限"提示，不继续生成 SVG。

#### 5.1.2 shiki 语言包裁剪

**改动文件：** `src/renderer/lib/workspace/workspace_code_highlighter.ts`

- 保留高频语言内联：`typescript / javascript / tsx / jsx / json / jsonc / python / shellscript / bash / markdown / yaml / css / html / go / rust / cpp / c / java / sql / toml / vue / svelte`；
- 其余语言从 `language_loaders` 中**移除静态映射**，改为"遇到未知语言时提示不支持高亮、降级纯文本"；
- 若需保留低频语言，改为独立的异步 `import()`（构建时仍会产出 chunk，但**不会**被主包引用，只有运行时遇到才拉取）。

#### 5.1.3 vendor 拆分

**改动文件：** `electron.vite.config.ts`

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        react: ["react", "react-dom", "react/jsx-runtime"],
        "mermaid-vendor": ["mermaid"],
        "editor-vendor": ["@tiptap/core", "@tiptap/react", "@tiptap/starter-kit"],
      },
    },
  },
}
```

- 目标：主入口 chunk 只保留业务代码 + 少量基础库，让 Vite 把重库拆到独立 chunk；
- `mermaid-vendor` 仅当 mermaid 动态化后仍被静态引用时才需要；若已动态化则无需此 chunk。

### 5.2 消息列表窗口化

#### 5.2.1 方案：基于行高的轻量虚拟列表

**新增文件：** `src/renderer/features/chat/lib/chat_virtual_list.ts`、`src/renderer/features/chat/components/ChatVirtualList.tsx`

**改动文件：** `src/renderer/features/chat/components/SessionMessageList.tsx`、`ChatMessageViewportRow.tsx`

设计要点：

1. **保留 `data-chat-viewport-row` 稳定标识**，用于滚动恢复与历史前插；
2. 维护一个**行高估算表** `Map<row_id, number>`：首次渲染时用真实高度回写，未测量行用**分段类型默认高度**（文本 48px / 代码块 160px / 图表 240px / 用户消息 64px）；
3. 用 IntersectionObserver + 滚动容器高度计算可视窗口，**只挂载视口 ± 缓冲（如 1 屏）内的行**，其余渲染 `<div style={{height: 估算高度}}>` 占位；
4. 文本选择语义：虚拟化后跨行选择仍可用，因为占位行只是不渲染内容，`data-chat-viewport-row` 顺序保持不变；
5. 滚动恢复：基于行号 + 行高累计，切换 Session 后回到同一行；
6. **流式更新**：只有当前可见的消息行需要实时更新，离屏行更新时只更新行高估算，不触发重渲染；
7. 渐进挂载保留：首次打开从最新一段开始，向前补历史，但补到视口外就停（不无限挂载）。

**为什么不自研成通用库：** 本列表有强约束（行高按内容类型估算、保留完整文本选择、历史前插、流式更新、主题切换），通用库的接口反而要大量适配。自研 200 行左右可满足，且与现有 `chat_scroll.ts` / `use_chat_scroll.ts` 的滚动恢复逻辑衔接。

#### 5.2.2 备选：`content-visibility: auto`

若虚拟化改动过大，可退而求其次：

```css
.chat-viewport-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}
```

- 优点：改动最小，浏览器自动跳过离屏行的布局与绘制；
- 缺点：行高估算不准确时滚动跳动；且**不释放 DOM 与 React 状态**，内存下降有限；
- 结论：作为 P1 兜底，不作为主方案。

### 5.3 重计算离屏化

#### 5.3.1 shiki 高亮迁移到 Web Worker

**新增文件：** `src/renderer/lib/workspace/highlight.worker.ts`

**改动文件：** `src/renderer/lib/workspace/workspace_code_highlighter.ts`

- Worker 内持有 shiki highlighter 单例，主线程通过 `postMessage` 提交高亮任务、接收 token 结果；
- 保持现有降级语义（失败/超时 → 纯文本）；
- 增加**任务队列 + 取消**：快速切换文件时取消未完成的高亮，避免旧结果覆盖新文件；
- Worker 在 Electron 渲染进程使用 Vite 的 `new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" })`。

#### 5.3.2 mermaid 渲染上限保护

- 单 Session 已渲染图表数阈值默认 **20**；
- 达到上限后新图表显示"图表超出单会话渲染上限"，用户可手动点按渲染单张；
- 配置项放入 `settings`（可选）。

### 5.4 数据面瘦身

#### 5.4.1 会话快照分页

**改动文件：** `src/main/agent/AgentController.ts`、`src/common/types/DesktopApi.ts`、`src/renderer/features/chat/state/use_chat_lifecycle.ts`

- `get_chat_snapshot` 新增可选参数 `{ limit?: number; before_sequence?: number }`，默认只返回**最近 200 条**可见消息 + `has_more`；
- 打开会话时先渲染最近 200 条（配合窗口化），用户向上滚动到顶再拉更早历史（已有 `get_chat_history` 分页能力）；
- IPC 协议向后兼容：旧调用不传参数仍返回整页（标记 `deprecated`），新调用传 `limit`。

#### 5.4.2 Main 进程缓存治理

- `session_unsubscribes` 已有清理；增加**空闲 Session 模型释放**：Session 关闭且无订阅后，从 `restored_session_models` 释放，下次打开再恢复；
- `runtimes` map 增加 LRU 上限（如 64 个），避免无限增长。

### 5.5 观测与回归

#### 5.5.1 性能预算表

**新增文件：** `docs/desktop-performance-budget.md`

| 指标 | 预算 | 检查时机 |
|---|---|---|
| 主 bundle（未压缩） | ≤ 3 MB | `pnpm build` |
| 渲染资源总大小 | ≤ 10 MB | `pnpm build` |
| 渲染进程峰值 RSS（空会话） | ≤ 450 MB | 手动 + 脚本 |
| 渲染进程峰值 RSS（1000 条消息） | ≤ 900 MB | 手动 + 脚本 |
| 消息列表滚动帧率 | ≥ 55 fps | DevTools |
| 打开 500 条消息会话 TTI | ≤ 1.5 s | DevTools |

#### 5.5.2 单元测试

**新增文件：** `app/desktop/tests/chat_virtual_list.test.ts`、`app/desktop/tests/chat_snapshot_paging.test.ts`、`app/desktop/tests/mermaid_dynamic_import.test.ts`（如可测）

- 窗口化：行高估算、可视窗口计算、滚动恢复、历史前插后行定位；
- 分页：`limit` 参数、`has_more`、`before_sequence` 翻页；
- mermaid 动态导入：渲染队列仍串行、id 稳定。

---

## 六、实施计划

按依赖关系分 4 个阶段，每阶段独立可交付、可回滚：

### 阶段 A：Bundle 瘦身（P0，先做）

| 任务 | 改动 | 验收 |
|---|---|---|
| A1 mermaid 动态化 | `render_mermaid.ts` + `electron.vite.config.ts` | 主包不再含 mermaid 核心；图表仍正常渲染 |
| A2 shiki 语言裁剪 | `workspace_code_highlighter.ts` | 主包体积下降；高频语言高亮正常 |
| A3 vendor 拆分 | `electron.vite.config.ts` | 主包 ≤ 3 MB |

**退出条件：** `pnpm build` 后主 bundle ≤ 3 MB、渲染资源 ≤ 10 MB；全部 `pnpm test` 通过。

### 阶段 B：消息列表窗口化（P0）

| 任务 | 改动 | 验收 |
|---|---|---|
| B1 行高估算表 | 新增 `chat_virtual_list.ts` | 单元测试覆盖估算与回写 |
| B2 虚拟列表组件 | 新增 `ChatVirtualList.tsx` | 长会话滚动 ≥ 55fps，文本选择可用 |
| B3 滚动恢复接入 | `SessionMessageList.tsx` | 切换 Session 回到原行 |

**退出条件：** 1000 条消息会话渲染进程 RSS ≤ 900 MB；滚动不卡顿；现有测试通过。

### 阶段 C：重计算离屏化（P1）

| 任务 | 改动 | 验收 |
|---|---|---|
| C1 shiki Worker | 新增 `highlight.worker.ts` | 打开大文件不阻塞 UI |
| C2 mermaid 上限 | `MermaidDiagram.tsx` | 超限图表显示占位 |

### 阶段 D：数据面瘦身（P1）

| 任务 | 改动 | 验收 |
|---|---|---|
| D1 快照分页 | `AgentController.ts` + `DesktopApi.ts` | 打开长会话只拉最近 200 条 |
| D2 Main 缓存治理 | `AgentController.ts` | 关闭 Session 后模型释放 |

**退出条件：** 全部阶段完成后，按 3.1 目标表复测。

---

## 七、风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| 虚拟化导致文本选择/滚动恢复回归 | 用户无法复制跨行内容 | 保留 `data-chat-viewport-row` 稳定标识；测试覆盖；若严重回退到 5.2.2 content-visibility 方案 |
| mermaid 动态导入在 Electron 下加载失败 | 图表不显示 | 降级为显示源码；保留静态引入的 fallback 开关 |
| shiki 语言裁剪误删用户常用语言 | 高亮失效 | 裁剪前先收集高频语言清单；未知语言降级纯文本而非报错 |
| 分页后历史消息渲染不正确 | 滚动到顶后历史缺失 | 复用已有 `get_chat_history`；`has_more` 语义测试 |
| Worker 在 Electron CSP 下不可用 | 高亮回退主线程 | 保留主线程实现作为 fallback；用 `contextIsolation` 下允许的 Worker 创建方式 |

---

## 八、验收标准（DoD）

1. 阶段 A 退出条件达成（主包 ≤ 3 MB、资源 ≤ 10 MB）；
2. 阶段 B 退出条件达成（1000 条消息 RSS ≤ 900 MB、滚动 ≥ 55fps）；
3. 全部新增单元测试通过，且现有 `pnpm test` 无回归；
4. 手动验证：打开长会话、流式生成、滚动到顶拉历史、切换 Session 恢复位置、文本选择复制；
5. 生产构建（`pnpm build`）与开发模式（`pnpm dev:desktop`）均验证；
6. `docs/desktop-performance-budget.md` 已建立并纳入 CI 检查。

---

## 九、附录

### 9.1 参考文档

- `docs/desktop-state-performance-redesign.md`（既有 store 层性能重构，本次在其之上做渲染层）
- `docs/session-sqlite-storage-redesign-prd.md`（存储层，分页依赖它）
- `docs/desktop-command-palette-prd.md`（PRD 写作风格参考）

### 9.2 相关代码索引

| 文件 | 作用 |
|---|---|
| `app/desktop/src/renderer/components/markdown/mermaid/render_mermaid.ts` | mermaid 渲染管线（待动态化） |
| `app/desktop/src/renderer/components/markdown/mermaid/MermaidDiagram.tsx` | 图表懒渲染组件 |
| `app/desktop/src/renderer/lib/workspace/workspace_code_highlighter.ts` | shiki 高亮（待 Worker 化） |
| `app/desktop/src/renderer/features/chat/components/SessionMessageList.tsx` | 消息分段投影（待窗口化） |
| `app/desktop/src/renderer/features/chat/components/ChatMessageViewportRow.tsx` | 消息行容器 |
| `app/desktop/src/renderer/features/chat/lib/chat_render_cache.ts` | 会话级渲染缓存 LRU |
| `app/desktop/src/main/agent/AgentController.ts` | Main 进程控制器（待分页） |
| `app/desktop/electron.vite.config.ts` | 构建配置（待瘦身） |

### 9.3 变更文件清单

**新增：**

- `app/desktop/src/renderer/features/chat/lib/chat_virtual_list.ts`
- `app/desktop/src/renderer/features/chat/components/ChatVirtualList.tsx`
- `app/desktop/src/renderer/lib/workspace/highlight.worker.ts`
- `app/desktop/tests/chat_virtual_list.test.ts`
- `app/desktop/tests/chat_snapshot_paging.test.ts`
- `docs/desktop-performance-budget.md`

**修改：**

- `app/desktop/electron.vite.config.ts`
- `app/desktop/src/renderer/components/markdown/mermaid/render_mermaid.ts`
- `app/desktop/src/renderer/components/markdown/mermaid/MermaidDiagram.tsx`
- `app/desktop/src/renderer/lib/workspace/workspace_code_highlighter.ts`
- `app/desktop/src/renderer/features/chat/components/SessionMessageList.tsx`
- `app/desktop/src/renderer/features/chat/components/ChatMessageViewportRow.tsx`
- `app/desktop/src/renderer/features/chat/state/use_chat_lifecycle.ts`
- `app/desktop/src/main/agent/AgentController.ts`
- `app/desktop/src/common/types/DesktopApi.ts`

---

## 十、待确认问题

1. **shiki 高频语言清单**：上表（5.1.2）是初版，需与产品确认实际使用分布。
2. **mermaid 单会话上限**：默认 20 是否合适？是否需要用户设置？
3. **快照分页默认 limit**：200 条是否合适？是否需要跟随窗口高度动态调整？
4. **虚拟列表是否接受复杂实现**：自研 vs 引入 `@tanstack/react-virtual` 的取舍需产品拍板。
5. **性能预算是否纳入 CI**：若纳入，需要确定在哪一步检查（`pnpm build` 后）。

---

*文档结束。本 PRD 为交付合同，实施前需完成「待确认问题」评审。*


---
