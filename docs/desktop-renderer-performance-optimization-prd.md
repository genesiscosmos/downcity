# Desktop 渲染进程性能优化 PRD

> 状态：**全部阶段已实施（A1 / B / C1 / D1 已落地；C2 实施后已移除；A2 完成评估）**
> 目标版本：`@downcity/desktop` 0.1.0（Electron 40.10.6 / React 19.2.6 / Vite 7.1.6）
> 关联代码：`app/desktop/`
> 实测基线：2026-09-21，渲染进程 RSS 约 1.8 GB，主进程约 538 MB，应用合计约 2.4 GB
> 修订：2026-09-21 二次评审。对 `out/renderer/assets` 产物与相关源码逐条复核后，修正了三处事实错误（P1 根因、P4 判断、`optimizeDeps` 作用范围）与一处内存归因偏差。修正依据见 4.6，变更明细见 11。
> 实施：2026-09-21。已完成阶段 A1、B、C1、C2、D1，A2 完成评估；包体基线与预算见 `docs/desktop-performance-budget.md`。
> 变更：2026-09-22 移除 C2 的图表渲染上限（见 5.3.2）。
> 待验证：B 的回收效果与全部运行时 RSS 指标需在生产构建中手动测量（见 `docs/desktop-performance-budget.md` 第三、四节）。

---

## 一、结论摘要

### 1.1 现状

当前 Desktop 渲染进程（Electron Helper Renderer）常驻内存约 **1.8 GB**，主进程约 **538 MB**。经实测与代码审查，根因不是单个泄漏，而是四类结构性问题叠加，其中 P4 的权重在复核后被下调：

| 编号 | 问题 | 证据 | 量级 |
|---|---|---|---|
| P1 | 主 bundle 静态内含 mermaid 核心等重库 | `render_mermaid.ts` 顶部静态 `import mermaid from "mermaid"`；主包 `index-*.js` 实测 6.34 MB，内部可检索到 `mermaidAPI` / `registerDiagram` / `addDiagrams` / `jison` / `calculateTextDimensions` 等 mermaid 运行时符号，以及 `prosemirror`、`katex`、`streamdown` | 高 |
| P2 | 消息列表不虚拟化、离屏 DOM 永不回收 | `ChatMessageViewportRow.tsx` 明确禁止 `content-visibility`；`ProgressiveMessageSegments` 只向前补挂载、从不卸载 | 高 |
| P3 | 高亮/图表等重计算在渲染主线程同步执行 | `workspace_code_highlighter.ts` 在 `useEffect` 内直接调用 shiki；`render_mermaid.ts` 静态引入 mermaid 到主包 | 中 |
| P4 | Main 进程会话投影 Map 无容量上限 | `AgentController` 的 `runtimes`、`restored_session_models` 仅在关闭 Session 或切换 Agent 时清理，无 LRU | 低–中 |

> 关于「351 个 chunk / 19.5 MB 渲染资源」：该数字本身准确（实测 351 个 JS chunk、19.5 MB JS、磁盘占用 21.99 MB），但它**不是内存根因**。其中约 300 个是 shiki 语言与主题分块，由 streamdown 的代码块组件在 `React.lazy` 下动态加载，启动时不加载任何一个，对 RSS 无直接贡献。详见 4.1。

### 1.2 本次要做的事

1. **主包减重**：把 mermaid 由静态导入改为动态导入，使 mermaid 核心离开主包；评估把 tiptap、katex、streamdown 等仅在特定交互中使用的重库改为延迟加载。
2. **长会话 DOM 回收**：为消息列表引入窗口化渲染，离屏消息只保留占位高度，进入视口才挂载真实内容。前提是先解决与原生滚动锚定的冲突（见 5.2）。
3. **重计算离屏化**：shiki 高亮迁移到 Web Worker；mermaid 渲染保持串行队列，靠滚动懒渲染与 LRU 缓存控制内存。
4. **数据面治理**：为 Main 进程的会话投影 Map 增加容量上限与空闲释放。会话快照分页**已经在位**，不再作为交付项。
5. **观测与回归**：先建立可信基线，再新增内存/包体预算测试。

### 1.3 本次明确不做的事

| 不做 | 原因 |
| --- | --- |
| 重构 Main 进程为独立渲染沙箱 / 把 Agent 挪到子进程 | 改变执行模型，风险高、收益不确定，超出本次范围 |
| 数据库/存储层优化 | Session 存储已在 `docs/session-sqlite-storage-redesign-prd.md` 单独规划 |
| 消息模型（SessionMessage）schema 变更 | 属于另一个 PRD 的范畴，本次只动渲染层 |
| 富文本编辑器（tiptap）替换 | 编辑器只在 composer 使用，本次只调整加载时机，不替换 |
| 主题/视觉重构 | 与性能无关 |
| 移动端 / 触屏布局 | Desktop 是 Electron 桌面应用 |
| 裁剪 `workspace_code_highlighter.ts` 的语言清单 | 该清单不是 300 个语言 chunk 的来源，裁剪它不会减少产物；且会缩小用户可见的支持语言范围（见 5.1.2） |

### 1.4 关键决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| mermaid 按需加载 | `render_mermaid.ts` 改为 `const { default: mermaid } = await import("mermaid")` | 静态导入是 mermaid 核心进入主包的原因，也是 P1 中唯一能靠一处改动直接消除的一项 |
| `optimizeDeps: { include: ["mermaid"] }` | **保留**，并在配置中补注释说明它只作用于 dev | 该配置属于 Vite 开发期依赖预构建，`vite build` 走 Rollup，不读取它。移除它对生产产物零影响，却可能拖慢 dev 冷启动（原注释已说明它是为 mermaid 的动态图表模块与 CommonJS 依赖而加） |
| 300 个 shiki 语言/主题 chunk | 本轮**不处理**，登记为待确认问题 | 由 streamdown 的代码块组件引入，动态加载，启动不拉取，对 RSS 无直接贡献；处理成本高（需替换 streamdown 代码块或做 alias stub），收益主要在磁盘占用 |
| shiki 语言包裁剪 | **取消**该交付项 | 产物里的全语言 chunk 不来自 `language_loaders`；裁剪它既不减产物也不减内存，还会缩小支持语言范围 |
| 高亮线程 | shiki 高亮迁移到 Web Worker | 高亮 400k 字符上限内的文件仍可能阻塞主线程数百 ms；Worker 隔离后 UI 不卡顿 |
| 消息列表窗口化方案 | 自研轻量虚拟列表，但**先完成 5.2.1 的锚定兼容设计**再动手 | 现有滚动恢复依赖浏览器原生滚动锚定，而锚定需要真实布局；估算行高会与之冲突。这不是实现细节，是本方案的前置条件 |
| 数据分页 | **取消**该交付项，改为 Main 进程缓存 LRU | `session.messages()` 默认已分页 50 条（上限 200）并返回 `has_more` / `next_before_sequence`，`get_chat_snapshot` 不传 limit 即取最近 50 条，渲染层已接 `get_history` 翻页 |
| 观测 | 先建立生产构建基线，再新增 `docs/desktop-performance-budget.md` 预算表 | 现有「1.8 GB 构成」为代码审查推断，未经 heap snapshot 验证，不足以支撑排期 |
| 与既有 PRD 的关系 | 本文档在渲染层性能上**优先于** `docs/desktop-agent-message-rendering-redesign-prd.md` | 该 PRD 已落地并明确保留 `ProgressiveMessageSegments` 与 `ChatMessageViewportRow`、要求「离屏静态消息继续使用浏览器原生渲染隔离」。两者方向相反，必须显式声明优先级，否则实施会撞车 |

---

## 二、背景

### 2.1 为什么现在做

Desktop 处于 0.1.0 快速迭代期，功能面在扩大（Agent / Group / Workspace / Power / 通知 / 命令面板），但渲染层性能没有专门治理。实测 1.8 GB 的渲染进程在 24 GB 内存机器上已占 7.2% 内存 + 高 CPU，会：

- 拖慢整个应用的响应（滚动、输入、切换 Session）；
- 与 Chrome / VS Code / 虚拟机争抢内存，触发系统 swap（当前 swap 已用 92%）；
- 影响用户对「桌面客户端」的第一印象——一个聊天应用不该比 IDE 还重。

### 2.2 现状代码结构（与本次相关的部分）

```text
app/desktop/src/renderer/
  main.tsx                                  入口（StrictMode + MotionConfig）
  app/DesktopShell.tsx                      壳层：侧栏 + BayBar + 命令面板
  app/use_desktop.ts                        会话加载、快照与历史翻页编排
  lib/store.ts                              use_store / use_store_selector（useSyncExternalStore 基元）
  features/chat/
    components/SessionMessageList.tsx       消息分段投影 + ProgressiveMessageSegments
    components/ChatMessageViewportRow.tsx   消息行容器（明确禁止 content-visibility）
    components/messages/*.tsx               单条消息渲染（AgentMessage / UserMessage / Markdown / Mermaid）
    lib/chat_render_cache.ts                会话级渲染缓存 LRU（默认保留 8 个）
    lib/use_chat_scroll.ts                  自动跟随、动态高度与历史前插滚动控制
    state/use_chat_stream_store.ts          高频消息/runtime store
  components/markdown/
    Markdown.tsx                            Streamdown 封装
    markdown_components.tsx                 自定义节点映射（含 mermaid-diagram）
    mermaid/MermaidDiagram.tsx              懒渲染 + 串行队列
    mermaid/render_mermaid.ts               静态 import mermaid（本次目标）
  lib/workspace/workspace_code_highlighter.ts  shiki 高亮（主线程，40 种语言）
```

### 2.3 已做对的部分（保留）

- 7 个 domain store + `useSyncExternalStore` 细粒度订阅（见 `docs/desktop-state-performance-redesign.md`），高频更新已按领域隔离；
- 会话级渲染缓存 LRU（`chat_render_cache.ts`）已存在，但只淘汰「渲染缓存」，不淘汰 DOM；
- mermaid 懒渲染（IntersectionObserver + 320px 提前量）与串行渲染队列已实现；
- Markdown 有 128KB / 行 64KB 的上限保护（`markdown_render_limits.ts`）；
- shiki 已做 400k 字符上限与语言按需加载（40 种语言，动态 `import()`，不进主包）；
- **会话快照已分页**：`session.messages()` 默认 50 条、上限 200，返回 `has_more` 与 `next_before_sequence`；渲染层已通过 `get_history` 向前翻页；
- workspace 文件预览有 2MB 上限；
- 消息分段渐进挂载（每 24ms 一段）避免首屏一次性卡死。

---

## 三、目标与非目标

### 3.1 目标（可量化）

> 本表在阶段 0（建立基线）完成后**必须重新校准**。下表的「当前」列已用实测产物值替换原推断值；「目标」列给出的是本轮的工程意图，而非拍定的数字。

| 指标 | 当前（实测/待测） | 目标 | 验证方式 |
|---|---|---|---|
| 主 bundle 未压缩体积 | **6.34 MB**（实测 `index-Bc_BCXmo.js`） | mermaid 核心移出后显著下降；具体数值以阶段 0 基线为准 | `pnpm build` + 产物统计 |
| 主 bundle gzip 体积 | **1.27 MB**（实测） | 同步下降 | `pnpm build` + 产物统计 |
| 首屏同步加载的代码总量 | 待测（主包 + 其静态依赖） | 明确列出延迟加载模块清单后再定数值 | 产物静态依赖分析 |
| 渲染资源总大小（JS） | **19.5 MB / 351 chunk**（实测） | 不作为本轮目标（见 1.4） | `pnpm build` + 产物统计 |
| 渲染进程峰值 RSS（空会话 + 侧栏） | 待测（需生产构建） | 以阶段 0 基线为参照，目标降幅 ≥ 30% | 生产构建 + `ps` / 性能面板 |
| 渲染进程峰值 RSS（1000 条消息长会话） | 待测（需生产构建） | 以阶段 0 基线为参照，目标降幅 ≥ 40% | 构造 1000 条消息会话后测量 |
| 消息列表滚动帧率（长会话） | 待测 | ≥ 55 fps | DevTools Performance 录制 |
| 打开 500 条消息会话的 TTI | 待测 | ≤ 1.5 s | Performance 面板 |

原文档给出的「主包 ≤ 3 MB」不可达且口径不清：`manualChunks` 只是把代码拆成独立文件，静态依赖拆出去后启动照样要加载，RSS 几乎不变；而主包里除 mermaid 核心外还有 react-dom、streamdown、katex、tiptap/prosemirror（已核实 `prosemirror` 只出现在主包，composer 未做懒加载）。要达标必须把编辑器、katex、streamdown 一并延迟加载，这需要单独立项评估。

### 3.2 非目标

- 不追求把渲染进程压到 200MB 以下的极限优化；
- 不做磁盘缓存 / 持久化层优化；
- 不改变 IPC 协议语义；
- 不牺牲正确性（文本选择、滚动恢复、历史前插、流式更新）来换性能；
- 不缩小用户可见的功能范围（含高亮支持语言）。

---

## 四、现状诊断

### 4.1 P1：主 bundle 静态内含重库

**实测产物（`app/desktop/out/renderer/assets/`）：**

| 产物 | 大小 | 说明 |
|---|---|---|
| `index-*.js`（主包） | **6,342,593 B（6.34 MB）**，gzip 1,273,728 B | 含 mermaid 核心、react-dom、streamdown、katex、tiptap/prosemirror、业务代码 |
| `wardley-*.js` | 1,209,092 B | mermaid wardley 图类型 |
| `cytoscape.esm-*.js` | 956,710 B | mermaid 依赖 cytoscape |
| `emacs-lisp-*.js` | 779,897 B | shiki 语法 |
| `cpp-*.js` | 626,556 B | shiki 语法 |
| `wasm-*.js` | 622,448 B | 由 streamdown 代码块引入的 wasm 资源 |
| **JS 合计 351 个 chunk** | **19.5 MB**（磁盘占用 21.99 MB / 411 文件） | 全部渲染资源 |

**根因（已逐条验证）：**

1. **`render_mermaid.ts` 顶部静态导入**（真实，主杠杆）。
   `import mermaid from "mermaid";` 把 mermaid 运行时拉进主包。验证方式：主包内可检索到 `mermaidAPI`（8 处）、`registerDiagram`（6 处）、`addDiagrams`（6 处）、`getDiagramFromText`（4 处）、`jison`（2 处）、`flowchart-elk`（3 处），以及 `calculateTextDimensions`、`cleanAndMerge`、`assignWithDepth_default` 等 mermaid 内部导出。
2. **mermaid 全图类型 chunk 被构建产出**（真实，但**不构成内存问题**）。
   wardley / architecture / sequence / gantt / venn / quadrant / timeline / xychart / c4 / flow / er / gitGraph / dagre / cytoscape / cose-bilkent 等分块在 `index` 的依赖映射表（`__vite__mapDeps`）中登记，属**动态**加载，启动不拉取。
3. **约 300 个 shiki 语言与主题分块来自 streamdown，不来自本仓库**（原文档此处归因错误）。
   验证：产物中 `code-block-IT6T5CEO-CpXslZNi.js` 内含 **300 条** `import("./<lang>.js")` 形式的动态导入，其中约 54 个是主题（`ayu-*`、`catppuccin-*`、`github-*`、`nord` 等）、其余是语法；`emacs-lisp`、`wolfram` 等并不在 `workspace_code_highlighter.ts` 的清单里，却由该分块独占引入。该分块由主包以 `React.lazy(() => __vitePreload(() => import("./code-block-*.js")))` 方式加载，即 streamdown 的代码块组件；`streamdown` 的依赖中包含 `shiki: ^3.12.2`。
   对照：`workspace_code_highlighter.ts` 的 `language_loaders` 只声明 40 种语言，且全部是动态 `import()`，构建时产出 chunk 但不被主包引用。
4. **tiptap / prosemirror / katex / streamdown 静态在主包**（真实）。
   验证：`prosemirror` 与 `tiptap` 只出现在 `index-*.js`，无独立分块，说明 composer 编辑器未做懒加载；`katex` 同时出现在主包与 `flowDiagram` 分块。
5. **`optimizeDeps: { include: ["mermaid"] }` 不是生产产物的成因**（原文档此处判断错误）。
   该配置属于 Vite 开发期依赖预构建，`vite build` 使用 Rollup，不读取 `optimizeDeps`。移除它对 `out/` 产物零影响。

**影响：** 主包 6.34 MB 在启动时同步解析与编译，是启动阶段内存与 TTI 的主要变量。第 2、3 条虽占磁盘，但均为懒加载，对启动内存无直接贡献；把它们与内存根因并列会误导排期。

### 4.2 P2：消息列表不虚拟化，离屏 DOM 永不回收

代码路径：`features/chat/components/SessionMessageList.tsx` + `ChatMessageViewportRow.tsx`。

- `ProgressiveMessageSegments` 只是**渐进挂载**：它渲染 `segments.slice(start_index)`，而 `start_index` 只会向更早的分段推进、从不回退，因此一旦挂载就**永远留在 DOM 树**；
- `ChatMessageViewportRow.tsx` 明确注释「这里【不要】加 `content-visibility`」，理由是离屏行按占位高度记账、进入视口后换真实高度，而行高相差一个数量级，会让用户向上浏览时反复看到内容被推走又弹回；
- 每条消息包含：完整 Markdown DOM 子树、React Fiber 节点、shiki token 数组、可能的 mermaid SVG。

**影响：** 会话消息数线性增长，DOM 节点 + React 状态 + 高亮 token 数组随之线性增长且**永不回收**。这是长会话后内存爬升的主因。

### 4.3 P3：高亮 / 图表等重计算在渲染主线程同步执行

- `workspace_code_highlighter.ts` 在调用方 `useEffect` 内触发 `highlight_code_lines`（shiki JS 正则引擎），400k 字符上限内的文件也可能阻塞主线程数百 ms；
- `render_mermaid.ts` 的串行渲染队列正确，但 mermaid 本身重（cytoscape、dagre 布局），渲染期间主线程仍被占用。

### 4.4 P4：Main 进程会话投影 Map 无容量上限

- `AgentController` 的 `runtimes`、`restored_session_models` 两个 Map 仅在关闭 Session（`release_session_projection`）或切换 Agent 时清理，没有 LRU 上限；
- `session_unsubscribes` 已有配套清理，属已做对的部分。

**修正说明：** 原文档称 `get_chat_snapshot`「一次传整页消息」并因此造成「main + renderer 双份数据」，该判断不成立。`SessionMessages.list_messages` 的默认页大小为 50、上限 200（`const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200)`），`get_chat_snapshot` 未传 limit，因此只取最近 50 条可见消息，并返回 `has_more` 与 `next_before_sequence`；渲染层 `use_desktop.ts` 已在滚动到顶时调用 `get_history` 翻页。数据面在这一维度上已经收敛。

### 4.5 内存构成估算（1.8 GB）

| 项目 | 估算 | 可信度 |
|---|---|---|
| Chromium 渲染器基础（GPU、合成器、V8 isolate） | 350–450 MB | 经验值 |
| 主包解析 + V8 heap + 模块运行时 | 待测 | **低**。原文档估 300–500 MB 偏高：6.34 MB 源码编译后的 V8 heap 通常在百 MB 量级，该数字疑似把渲染器基础开销重复计入 |
| mermaid / shiki / katex / tiptap 运行时数据结构 | 待测 | 低。仅当对应功能被实际使用时才产生 |
| 消息 DOM 树 + React Fiber（长会话） | 待测 | 中。与 P2 对应，是最可能的主要项 |
| dev 模式额外开销（sourcemap、HMR、devtools） | 100–200 MB | 经验值 |

**该表不足以支撑排期。** 原文档据此直接排定 P1–P4 优先级与 DoD 数字，属于用推断值驱动决策。基线也未区分生产构建与 dev 模式，而 bundle 优化在两种模式下的收益差别很大（dev 下 Vite 不打包，bundle 分析无意义）。因此阶段 0 改为强制前置。

### 4.6 复核方法与可复现命令

上述结论均可复现，供评审复核：

```bash
# 1. 产物体积与分块数量
cd app/desktop && du -sh out/renderer/assets && ls out/renderer/assets/*.js | wc -l

# 2. 主包是否内含 mermaid 核心
cd app/desktop/out/renderer/assets
grep -c 'mermaidAPI\|registerDiagram\|addDiagrams' index-*.js

# 3. 全语言 chunk 的来源分块
rg -l 'emacs-lisp-.*\.js' .
# → 仅命中 code-block-*.js（streamdown 代码块），不命中 workspace_code_highlighter 的产物

# 4. 该分块的动态导入数量
rg -o 'import\("\./[a-zA-Z0-9_.-]+\.js"\)' -N code-block-*.js | sort -u | wc -l   # → 300

# 5. 快照默认页大小
grep -n 'input?.limit' ../../../../packages/agent/src/session/messages/SessionMessages.ts
```

---

## 五、方案设计

### 5.1 主包减重

#### 5.1.1 mermaid 动态化（本轮最高确定性收益）

**改动文件：** `src/renderer/components/markdown/mermaid/render_mermaid.ts`

```ts
// 之前：import mermaid from "mermaid";
// 之后：mermaid 只在使用时加载
let mermaid_promise: Promise<typeof import("mermaid")> | undefined;
function get_mermaid() {
  mermaid_promise ??= import("mermaid");
  return mermaid_promise;
}
```

- `render_mermaid_svg_now` 内改为 `const { default: mermaid } = await get_mermaid();` 后再 `initialize` / `render`；
- 保留现有串行队列、稳定 id、主题在渲染时读取三条既有语义，不改行为；
- **不修改** `electron.vite.config.ts` 的 `optimizeDeps`（原因见 1.4）；
- 验收：`pnpm build` 后主包内不再能检索到 `mermaidAPI` / `registerDiagram`；图表渲染与主题切换行为不变。

#### 5.1.2 关于 shiki 语言包（原方案取消）

原计划裁剪 `workspace_code_highlighter.ts` 的 `language_loaders`。复核后确认该动作无效：

- 产物中的全语言 chunk 由 streamdown 的 `code-block` 分块引入（300 条动态导入），与 `language_loaders` 无关；
- `language_loaders` 的语言是动态 `import()`，不进主包，裁剪它既不减主包也不减内存；
- 裁剪需同步修改 `WorkspaceLanguage` 类型（该文件注释明确「漏掉一种会在类型检查阶段报错」），等于缩小用户可见的支持语言范围，属产品决策而非性能优化。

若后续确实要处理这 300 个分块，候选方案有三条，成本递增：

1. **接受现状**（推荐先做）：它们是懒加载，启动不拉取，对 RSS 无直接贡献，仅占磁盘；
2. **alias stub**：在 `renderer.resolve.alias` 中把不需要的 `shiki/langs/*` 与 `shiki/themes/*` 指向空模块，减小磁盘占用，但需验证 streamdown 在缺失语法时的降级行为；
3. **替换 streamdown 的代码块**：本仓库在 `workspace_code_highlighter.ts` 已有一套自管的 shiki 集成（40 种语言、明暗双主题、按需加载），改为复用它可同时统一两处高亮实现。改动面大，建议单独立项。

#### 5.1.3 vendor 拆分的适用边界

`manualChunks` 应作为**降低缓存失效**的手段，而不是减重手段：

- 拆分后各 chunk 仍在启动时被静态加载，RSS 不会因此下降；
- 仅在确有需要时配置，且不要为 `mermaid` 建 `mermaid-vendor` chunk——mermaid 动态化之后它不应再出现在主包的静态依赖图里，若仍出现说明 5.1.1 未生效，应修 5.1.1 而不是加 chunk。

#### 5.1.4 重库延迟加载评估（A2 结论）

用临时 `manualChunks` 配置把候选库拆成独立 chunk 后实测（方法：在 `renderer.build.rollupOptions.output.manualChunks` 中按 `node_modules` 路径归组，构建后统计各 chunk 体积；测量配置用完已删除）。数据为未压缩体积：

| 依赖 | 体积 | 当前加载时机 | 能否延迟加载 |
|---|---|---|---|
| `@tiptap/*` + `prosemirror` | **785.63 kB** | 静态（composer 入口） | **可以**：编辑器只在 Chat 视图的输入区使用，且首屏无需可编辑 |
| `katex` | **487.18 kB** + 28.95 kB CSS | 静态 | **可以**：数学公式只在含 `$...$` 的消息里出现 |
| `streamdown` | **56.55 kB** | 静态 | 不建议：体积小，且是消息正文的必经路径，延迟会拖慢首屏渲染 |
| `react` + `react-dom` | **1,378.99 kB** | 静态 | **不可以**：框架本身 |
| markdown 管线（marked / micromark / remark / rehype / hast / mdast / unified） | **445.94 kB** | 静态 | 部分可以，但与 streamdown 耦合 |
| `react-icons` | **64.57 kB** | 静态 | 不值得：体积小且被全局使用 |
| `i18next` + `react-i18next` | **82.48 kB** | 静态 | 不可以：语言包需要同步可用 |
| `tailwind-merge` + `clsx` + `cva` | **174.22 kB** | 静态 | 不可以：`cn()` 在渲染热路径 |

**结论：** 真正值得延迟加载的是 **tiptap + prosemirror（约 786 kB）**，其次是 katex（约 487 kB + 29 kB CSS）。两者合计约 1.3 MB，约为当前主包（5,421.50 kB）的 24%。

**但本次不实施**，原因有三：

1. **与 B 阶段相互影响。** 消息正文渲染依赖 streamdown 与 katex，它们的加载时机与窗口化方案共享同一套渲染预算，应在 B 阶段一并设计。
2. **首屏收益不确定。** 编辑器延迟加载会把「可输入」这一关键交互往后推；katex 延迟会让含公式的消息先以纯文本显示再变成公式，出现内容回流。两者都需要先有 TTI 基线才能判断净收益。
3. **测量方法的边界。** 上表的数字来自 `manualChunks` 归组，而 `manualChunks` 会把动态 chunk 合并进同一文件（本次测量中 shiki 因此显示为 9,628.68 kB、mermaid 显示为 3,557.89 kB，远高于它们在真实构建中的分散懒加载分块）。因此本表只用于**比较各静态依赖的相对占比**，不能当作「移除后主包会减少多少」的精确预测。

**建议：** 在 B 阶段完成后、拿到 TTI 与 RSS 基线时，把 tiptap 延迟加载作为独立小项评估。

`manualChunks` 应作为**降低缓存失效**的手段，而不是减重手段：

- 拆分后各 chunk 仍在启动时被静态加载，RSS 不会因此下降；
- 仅在确有需要时配置，且不要为 `mermaid` 建 `mermaid-vendor` chunk——mermaid 动态化之后它不应再出现在主包的静态依赖图里，若仍出现说明 5.1.1 未生效，应修 5.1.1 而不是加 chunk。

### 5.2 消息列表窗口化

**实施结论（2026-09-21）：采用分段卸载，已落地。**

实际实现与本节原方案不同，原因是在读代码时发现一条更经济的路径。分段是 32 条一组的固定 sequence 区间（`session_message_projection.ts`），本身已经是一个天然的回收单位；对分段做整体卸载不需要自研虚拟列表，也不需要接管滚动锚定。

实现：新增 `ChatRetainedSegment.tsx`，在 `SessionMessageList` 中包住每个 `SessionMessageSegment`。分段离开视口（rootMargin 一屏）后卸载内容，只留一个空容器；滚回来时从 canonical 消息重新渲染。

#### 5.2.1 前置条件：与原生滚动锚定的冲突（已解决）

`use_chat_scroll.ts` 把「视口上方的高度变化必须被补偿」写成不变量，`chat.css` 也显式禁止给消息行做离屏布局跳过。这两条约束的原话是「占位值与真实值差异通常是一个数量级」。

关键在于：约束反对的是**估算高度**，而不是占位本身。分段卸载在卸载前记录该分段的**实测高度**（`entry.boundingClientRect.height`），用等高容器替换。替换前后高度相等，不产生「视口上方内容变高」，浏览器原生锚定继续有效，`overflow-anchor: auto` 也不需要改动。

三条配套约束：

1. **流式分段永不回收。** 流式消息高度每帧都在变，占位值立刻过期。
2. **宽度变化时立即重新挂载。** 换行数随宽度变化，旧高度不再成立；窗口缩放是低频操作，这一次重排可以接受。
3. **只在长会话启用。** 卸载会让离屏内容不再参与浏览器 Ctrl+F 查找与跨分段文本选择，这是实打实的功能损失。分段固定 32 条，阈值定为 3 个分段（约 96 条消息）以下不启用。

#### 5.2.2 需要保留的语义（已保留）

1. 保留 `data-chat-viewport-row` 稳定标识，用于滚动恢复与历史前插；
2. 保留 `SessionMessageRow` / `SessionMessageSegment` 的 memo 引用比较边界（`docs/desktop-agent-message-rendering-redesign-prd.md` 已将其列为最高性能风险）；
3. 保留历史前插的恢复点：由 `content_key` 变化触发的 layout effect 承担，不能改成「await 之后再补一帧」；
4. 流式更新只作用于可见行；
5. 跨行文本选择与浏览器查找可用。

#### 5.2.3 备选：`content-visibility: auto`

仍可作为兜底，但需明确它的代价：`ChatMessageViewportRow.tsx` 与 `use_chat_scroll.ts` 都已说明它会引入高度跳动，且**不释放 DOM 与 React 状态**，内存下降有限。若采用，需与滚动锚定策略一起设计，而不是当作「改动最小的替代品」。

### 5.3 重计算离屏化

#### 5.3.1 shiki 高亮迁移到 Web Worker

**新增文件：** `src/renderer/lib/workspace/highlight.worker.ts`
**改动文件：** `src/renderer/lib/workspace/workspace_code_highlighter.ts`

- Worker 内持有 shiki highlighter 单例，主线程通过 `postMessage` 提交高亮任务、接收 token 结果；
- 保持现有降级语义（失败/超时/行数不一致 → 纯文本）；
- 增加任务队列 + 取消：快速切换文件时取消未完成的高亮，避免旧结果覆盖新文件；
- Worker 创建方式：`new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" })`；
- 保留主线程实现作为 CSP 不可用时的 fallback。

#### 5.3.2 mermaid 渲染上限保护（已取消）

原计划给单 Session 的已渲染图表数设 20 张上限，超出后新图表转占位、由用户手动点按渲染。该机制已实现后又移除：它拦住的正是用户在长会话里真正想看的图，而实际收益只是少渲染若干张 SVG。

图表内存改由两条既有机制控制：滚动懒渲染（`render_root_margin` 320px）与按「源码 + 主题令牌」的 LRU 渲染缓存（32 项）。若后续重新引入数量限制，需先用第三节的 RSS 基线证明图表是内存主要来源。

### 5.4 数据面治理

#### 5.4.1 会话快照分页（已实现，取消交付项）

现状已满足需求，无需改动：

- `session.messages()` 默认返回最近 50 条、上限 200，含 `has_more` 与 `next_before_sequence`；
- `get_chat_snapshot` 不传 limit，即取最近 50 条可见消息；
- 渲染层已在 `use_desktop.ts` 的 `load_earlier_history` 中调用 `get_history` 向前翻页；
- `DesktopChatSnapshot` / `DesktopChatHistoryPage` 已带分页字段。

若产品希望调整默认页大小（如改为 100），只需在 `AgentController.get_chat_snapshot` 传入 `limit`，属参数调整而非架构改造。

#### 5.4.2 Main 进程缓存治理（本轮唯一的数据面交付项）

- `runtimes`、`restored_session_models` 增加 LRU 上限（如 64 个会话），超出后淘汰最久未访问项；
- Session 关闭且无订阅时，从两个 Map 释放，下次打开再恢复（`release_session_projection` 已有部分逻辑，补齐容量维度即可）。

### 5.5 观测与回归

#### 5.5.1 阶段 0：建立可信基线（强制前置）

在改任何代码之前完成，产出写入 `docs/desktop-performance-budget.md`：

1. 用**生产构建**（`pnpm build` 后运行打包产物）测量空会话与 1000 条消息会话的渲染进程 RSS；
2. 用 Chromium 的 heap snapshot 拆分 `DOM nodes` / `JS heap` / `GPU` 三项占比，替换 4.5 的推断值；
3. 记录主包体积与 gzip 体积、首屏同步加载的代码总量；
4. 记录滚动帧率与 TTI。

只有拿到这份基线，才能判断 P1 与 P2 谁该优先，也才能给 3.1 定出可达的数字。

#### 5.5.2 性能预算表

**新增文件：** `docs/desktop-performance-budget.md`，字段在阶段 0 后确定，至少包含：

| 指标 | 预算 | 检查时机 |
|---|---|---|
| 主 bundle 未压缩体积 | 阶段 0 后确定 | `pnpm build` |
| 首屏同步加载代码总量 | 阶段 0 后确定 | `pnpm build` |
| 渲染进程峰值 RSS（空会话） | 阶段 0 后确定 | 生产构建 + 脚本 |
| 渲染进程峰值 RSS（1000 条消息） | 阶段 0 后确定 | 生产构建 + 脚本 |
| 消息列表滚动帧率 | ≥ 55 fps | DevTools |
| 打开 500 条消息会话 TTI | ≤ 1.5 s | DevTools |

#### 5.5.3 单元测试

**新增：** `app/desktop/tests/chat_virtual_list.test.ts`（若采用 5.2 的窗口化路径）、`app/desktop/tests/mermaid_dynamic_import.test.ts`

- 窗口化：行高估算与回写、可视窗口计算、滚动恢复、历史前插后行定位、卸载后重建一致性；
- mermaid 动态导入：渲染队列仍串行、id 稳定、主题切换后重渲染正确。

---

## 六、实施计划

按依赖关系分 5 个阶段，每阶段独立可交付、可回滚。

### 阶段 0：建立基线（强制前置，无代码改动）

| 任务 | 产出 | 验收 |
|---|---|---|
| 0.1 生产构建 RSS 基线 | `docs/desktop-performance-budget.md` 初版 | 空会话 / 1000 条消息两组数据 |
| 0.2 heap snapshot 拆分 | DOM / JS heap / GPU 占比 | 替换 4.5 推断值 |
| 0.3 首屏同步加载代码清单 | 延迟加载候选模块列表 | 据此校准 3.1 |

**退出条件：** 基线文档建立，3.1 目标表按实测重新校准。**未完成不得进入阶段 A。**

### 阶段 A：主包减重

| 任务 | 改动 | 验收 |
|---|---|---|
| A1 mermaid 动态化 | `render_mermaid.ts` | 主包不再含 mermaid 核心；图表与主题行为不变 |
| A2 重库延迟加载评估 | 评估 `tiptap` / `katex` / `streamdown` | 产出可行性结论与收益估算，**不直接实施** |

**退出条件：** `pnpm build` 后主包内无法检索到 mermaid 运行时符号；全部 `pnpm test` 通过。

### 阶段 B：长会话 DOM 回收

| 任务 | 改动 | 验收 |
|---|---|---|
| B1 选定路径 | 5.2.1 的方案 1/2/3 选型并记录理由 | 选型经评审确认 |
| B2 实现与滚动锚定兼容 | 按选型改动 `SessionMessageList.tsx` / `use_chat_scroll.ts` | 向上浏览无内容推走弹回；跨行选择可用 |
| B3 滚动恢复接入 | 切换 Session 回到原行 | 与 `chat_scroll.ts` 既有测试一致 |

**退出条件：** 1000 条消息会话 RSS 相对基线下降 ≥ 40%；滚动不卡顿；现有测试通过。

### 阶段 C：重计算离屏化

| 任务 | 改动 | 验收 |
|---|---|---|
| C1 shiki Worker | 新增 `highlight.worker.ts` | 打开大文件不阻塞 UI；降级路径可用 |
| C2 mermaid 上限 | `MermaidDiagram.tsx` | ~~超限图表显示占位并可手动渲染~~ **已移除**，图表不设数量上限（见 5.3.2） |

### 阶段 D：Main 进程缓存治理

| 任务 | 改动 | 验收 |
|---|---|---|
| D1 空闲 Session 实例回收 | `AgentSessions.release()` + `AgentController.trim_idle_session_runtimes()` | 打开 100+ 会话后实例缓存受控 |

**实施说明（2026-09-21）：** D1 的落点由复核修正——真正持有 Session 实例的是 `packages/agent` 的 `AgentSessions.sessions_by_id`，它只在 `remove` / `archive` / `workspace` 时删除条目，没有容量上限；`AgentController` 的 `runtimes` / `restored_session_models` 只是小对象投影。因此新增 `AgentSessions.release()`，由 `AgentController` 在打开会话时调用 `trim_idle_session_runtimes()`（上限 32 个空闲实例）。两条必须遵守的约束写入 `docs/desktop-performance-budget.md` 第五章：释放前必须先解除订阅；空闲回收不能复用 `release_session_projection`（它会删除持久化的模型设置）。

**退出条件：** 全部阶段完成后，按校准后的 3.1 目标表复测。

---

## 七、风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| 窗口化破坏原生滚动锚定 | 向上浏览时内容推走弹回，滚动位置丢失 | 5.2.1 先完成选型；采用「仅对超阈值会话启用」或「分段卸载」收敛回归面；测试覆盖历史前插与滚动恢复 |
| 窗口化导致文本选择/浏览器查找回归 | 用户无法复制跨行内容 | 保留 `data-chat-viewport-row` 稳定标识与行序；保留完整消息 DOM 语义 |
| mermaid 动态导入在 Electron 下加载失败 | 图表不显示 | 降级为显示源码；失败时回退到静态导入的构建开关 |
| Worker 在 Electron CSP 下不可用 | 高亮回退主线程 | 保留主线程实现作为 fallback |
| 与 `desktop-agent-message-rendering-redesign-prd.md` 的既有约束冲突 | 实施时两套设计互相推翻 | 本文档已在 1.4 声明在渲染层性能上优先；实施前需同步更新该 PRD 的相关条目 |
| 基线未建立即开工，优化方向靠推断 | 做完发现收益与预期不符 | 阶段 0 设为强制前置，未完成不得进入阶段 A |

---

## 八、验收标准（DoD）

1. 阶段 0 基线文档已建立，3.1 目标表按实测校准；
2. 阶段 A 退出条件达成：主包不再含 mermaid 运行时符号；
3. 阶段 B 退出条件达成：1000 条消息会话 RSS 相对基线下降 ≥ 40%，滚动 ≥ 55 fps，向上浏览无高度跳动；
4. 阶段 C、D 退出条件达成；
5. 全部新增单元测试通过，且现有 `pnpm test` 无回归；
6. 手动验证：打开长会话、流式生成、滚动到顶拉历史、切换 Session 恢复位置、文本选择复制、明暗主题切换后图表重渲染；
7. 生产构建（`pnpm build`）验证通过；`docs/desktop-performance-budget.md` 已建立并纳入 CI 检查。

---

## 九、附录

### 9.1 参考文档

- `docs/desktop-state-performance-redesign.md`（既有 store 层性能重构，本次在其之上做渲染层）
- `docs/desktop-agent-message-rendering-redesign-prd.md`（消息渲染分层；**其保留分段挂载与 Viewport Row 的条目与本文档冲突，实施前需同步更新**）
- `docs/session-sqlite-storage-redesign-prd.md`（存储层）
- `docs/desktop-command-palette-prd.md`（PRD 写作风格参考）

### 9.2 相关代码索引

| 文件 | 作用 | 本轮动作 |
|---|---|---|
| `app/desktop/src/renderer/components/markdown/mermaid/render_mermaid.ts` | mermaid 渲染管线 | **静态导入改动态（A1）** |
| `app/desktop/src/renderer/components/markdown/mermaid/MermaidDiagram.tsx` | 图表懒渲染组件 | 无渲染上限（C2 已移除） |
| `app/desktop/src/renderer/lib/workspace/workspace_code_highlighter.ts` | shiki 高亮（主线程，40 语言） | 迁移 Worker（C1）；**语言清单不改** |
| `app/desktop/src/renderer/features/chat/components/SessionMessageList.tsx` | 消息分段投影与渐进挂载 | 长会话回收（B2） |
| `app/desktop/src/renderer/features/chat/components/ChatMessageViewportRow.tsx` | 消息行容器 | 随 B 调整 |
| `app/desktop/src/renderer/features/chat/lib/use_chat_scroll.ts` | 滚动跟随与历史前插恢复 | 随 B 调整（锚定策略） |
| `app/desktop/src/renderer/features/chat/lib/chat_render_cache.ts` | 会话级渲染缓存 LRU（保留 8 个） | 参考，不改 |
| `app/desktop/src/main/agent/AgentController.ts` | Main 进程控制器 | 投影 Map 加 LRU（D1） |
| `app/desktop/src/common/types/DesktopApi.ts` | IPC 类型 | **不改**（分页字段已在位） |
| `app/desktop/electron.vite.config.ts` | 构建配置 | **不改**（`optimizeDeps` 保留） |
| `packages/agent/src/session/messages/SessionMessages.ts` | 消息分页实现 | **不改**（默认 50 / 上限 200） |

### 9.3 变更文件清单

**新增：**

- `app/desktop/src/renderer/lib/workspace/highlight.worker.ts`
- `app/desktop/tests/chat_virtual_list.test.ts`（若采用窗口化路径）
- `app/desktop/tests/mermaid_dynamic_import.test.ts`
- `docs/desktop-performance-budget.md`

**修改：**

- `app/desktop/src/renderer/components/markdown/mermaid/render_mermaid.ts`
- `app/desktop/src/renderer/components/markdown/mermaid/MermaidDiagram.tsx`
- `app/desktop/src/renderer/lib/workspace/workspace_code_highlighter.ts`
- `app/desktop/src/renderer/features/chat/components/SessionMessageList.tsx`
- `app/desktop/src/renderer/features/chat/components/ChatMessageViewportRow.tsx`
- `app/desktop/src/renderer/features/chat/lib/use_chat_scroll.ts`
- `app/desktop/src/main/agent/AgentController.ts`

**不再改动（原文档列为修改项）：**

- `app/desktop/electron.vite.config.ts` — `optimizeDeps` 保留；无 `manualChunks` 需求
- `app/desktop/src/common/types/DesktopApi.ts` — 分页字段已在位
- `app/desktop/src/renderer/features/chat/state/use_chat_lifecycle.ts` — 无分页改动需求
- `app/desktop/src/renderer/features/chat/lib/chat_virtual_list.ts` — 选型确定前不新建
- `app/desktop/src/renderer/features/chat/components/ChatVirtualList.tsx` — 同上
- `app/desktop/tests/chat_snapshot_paging.test.ts` — 分页已实现，无需新增

---

## 十、待确认问题

1. **长会话 DOM 回收走哪条路径**：5.2.1 的方案 1（接管锚定）/ 2（超阈值启用）/ 3（分段卸载）需产品与前端共同拍板。方案 3 与现有架构冲突最小。
2. **主包减重的终点在哪**：只做 mermaid 动态化，还是把 tiptap / katex / streamdown 一并延迟加载？后者才能显著降低首屏同步代码量，但改动面大且需评估编辑器懒加载对首屏交互的影响。
3. **300 个 shiki 语言/主题分块是否处理**：接受现状（推荐）/ alias stub / 复用自管 shiki 集成替换 streamdown 代码块。
4. ~~**mermaid 单会话渲染上限**：默认 20 是否合适？是否需要用户设置？~~ 已决议：不设上限，机制已移除（见 5.3.2）。
5. **会话快照默认页大小**：当前 50 条是否合适？若调整，直接改 `get_chat_snapshot` 传入的 `limit` 即可。
6. **性能预算是否纳入 CI**：若纳入，检查点定在 `pnpm build` 之后。

---

## 十一、修订记录

本次修订基于对 `app/desktop/out/renderer/assets` 产物与相关源码的逐条复核，修正以下内容：

| 原文档 | 问题 | 修订 |
|---|---|---|
| 4.1 根因 4「`language_loaders` 声明 40+ 语言，构建图保留全部语言 chunk」 | 归因错误。全语言 chunk 由 streamdown 的 `code-block` 分块（300 条动态导入）引入，与 `language_loaders` 无关 | 改写为根因 3，附可复现验证命令；5.1.2 由「裁剪语言包」改为「取消该交付项 + 三条候选方案」 |
| 4.1 根因 1「`optimizeDeps.include: ["mermaid"]` 让 mermaid 在启动阶段完整预构建进主包」 | 判断错误。`optimizeDeps` 仅作用于 Vite 开发期，`vite build` 不读取它 | 1.4 决策改为「保留该配置」；4.1 新增根因 5 说明其真实作用范围；9.3 从修改清单移除 `electron.vite.config.ts` |
| 4.4「`get_chat_snapshot` 一次传整页消息，main + renderer 双份数据」 | 不成立。默认页大小 50、上限 200，已返回分页字段，渲染层已接 `get_history` | 4.4 改写为「投影 Map 无容量上限」；5.4.1 由「实现分页」改为「已实现，取消交付项」；6 阶段 D 只保留 LRU |
| 4.5「6 MB JS 解析 + V8 heap 300–500 MB」 | 估值偏高，疑似重复计入渲染器基础开销；且未区分生产构建与 dev | 标注可信度为「低」，并明确基线须用生产构建建立；阶段 0 设为强制前置 |
| 3.1「主 bundle ≤ 3 MB」 | 口径不清且不可达：`manualChunks` 不减 RSS；主包另有 react-dom / streamdown / katex / tiptap | 目标改为「首屏同步加载的代码总量」，数值待阶段 0 校准；1.3 增加「不裁剪语言清单」 |
| 5.1.3「`mermaid-vendor` chunk」 | 与 5.1.1 动态化矛盾 | 改写为 vendor 拆分的适用边界说明 |
| 7「若严重回退到 5.2.2 content-visibility 方案」 | 循环论证：`content-visibility` 正是当前代码明确排除的做法 | 5.2.1 新增锚定冲突分析，给出三条可行路径；7 的风险缓解改为路径选型 |
| 未提及 | 与 `desktop-agent-message-rendering-redesign-prd.md` 的既有约束直接冲突 | 1.4 与 9.1 增加优先级声明；7 增加冲突风险项 |

---

*文档结束。本 PRD 为交付合同，实施前需完成「待确认问题」评审与阶段 0 基线建立。*
