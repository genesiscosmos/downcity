# Desktop 性能预算

> 状态：**已建立（阶段 0 完成，包体部分为实测；RSS 部分待补）**
> 关联 PRD：`docs/desktop-renderer-performance-optimization-prd.md`
> 建立日期：2026-09-21
> 环境：Node v24.3.0 / pnpm 10.22.0 / Electron 40.10.6 / Vite 7.1.6

本文档是 Desktop 渲染进程的性能预算表。任何改动产物构成或渲染热路径的提交，都应对照本表复核。数值分两类：**实测值**来自本机生产构建（`pnpm build`），**待测值**需要运行打包产物后测量。

---

## 一、包体预算

测量方式：`pnpm build` 后统计 `app/desktop/out/renderer/assets/`。

| 指标 | 基线（A1 前） | 当前（A1 + B + C1 后） | 变化 | 预算 |
|---|---|---|---|---|
| 主 bundle 未压缩 | 6,427,730 B（6.13 MiB） | **5,423,890 B（5.17 MiB）** | **−1,003,840 B（−15.6%）** | ≤ 5.5 MiB |
| 主 bundle gzip | 1,293,879 B | **1,117,334 B** | **−176,545 B（−13.6%）** | ≤ 1.15 MiB |
| JS chunk 总数 | 351 | **393** | **+42** | 见下方说明 |
| 渲染资源磁盘占用 | 22 MB | **25 MB** | **+3 MB** | ≤ 25 MB（已到上限） |

主包减少的约 1 MB 是 mermaid 核心及其布局依赖，已拆到独立的 `mermaid.core-*.js`（994.14 kB），首次渲染图表时才加载。C1 的 Worker 化只增加约 2 kB（着色核心本就在主包内，新增的只是 Worker 客户端与消息协议），着色计算本身移到 `highlight.worker-*.js`（355.96 kB）。B 增加约 2.4 kB（分段回收容器）。C2 曾增加约 2.7 kB，移除后已回收（见变更记录）。

### chunk 数与磁盘增长的归因

C1 把着色搬进 Worker 后，JS chunk 从 351 涨到 393、磁盘从 22 MB 涨到 25 MB。这是**真实的回归，不是计数误差**：Worker 是独立构建单元，Vite 为它单独产出一份语言分块（40 个，`highlight.worker-*.js` 中可数到 40 条 `import("./<lang>-*.js")`），与主线程回退路径那份重复。

影响评估：

- 这些分块都是**懒加载**的：首次打开源码视图才创建 Worker、才拉取对应语言，不进入首屏，对启动内存无直接贡献；
- 代价主要是磁盘占用（+3 MB），而当前磁盘预算就是 25 MB，**已经顶到上限**。

后续若要消除重复，可选：把语言加载器改为在 Worker 内静态登记、随 Worker 打成一个自包含文件（代价是 Worker 产物变大但不再需要独立分块）；或改用 `?worker&inline` 让 Worker 内联。两者都需先验证 `file://` 下的行为（见下方待验证项）。

**主 bundle 的预算口径**是「启动时同步解析的代码」。`manualChunks` 类的拆分不改变这一口径——被拆出的静态依赖仍在启动时加载，只有改为动态 `import()` 才真正移出。因此本表只对主 bundle 体积设预算，不对 chunk 数量设预算。

---

## 二、主包内容约束

以下符号不应出现在主 bundle 中，它们是重库被静态引入的信号：

| 符号 | 归属 | 当前主包内出现次数 | 说明 |
|---|---|---|---|
| `mermaidAPI` | mermaid | 0 | A1 后已移出 |
| `registerDiagram` | mermaid | 0 | A1 后已移出 |
| `addDiagrams` | mermaid | 0 | A1 后已移出 |
| `getDiagramFromText` | mermaid | 0 | A1 后已移出 |
| `calculateTextDimensions` | mermaid | 0 | A1 后已移出 |
| `prosemirror` | tiptap | 52 | 编辑器未懒加载，**当前允许** |
| `katex` | streamdown / katex | 41 | 数学渲染，**当前允许** |

复核命令：

```bash
cd app/desktop/out/renderer/assets
for symbol in mermaidAPI registerDiagram addDiagrams getDiagramFromText; do
  printf '%-24s %s\n' "$symbol" "$(grep -o "$symbol" index-*.js | wc -l)"
done
```

> 注意：`jison` 不是有效信号。streamdown 的语言别名表里含 `jison: "jison"` 条目，主包内会稳定出现 2 处，与 mermaid 无关。

---

## 三、运行时预算（待测）

以下指标需要运行打包产物后测量，当前为空白。补齐后本表纳入 CI。

| 指标 | 基线 | 预算 | 测量方式 |
|---|---|---|---|
| 渲染进程峰值 RSS（空会话 + 侧栏） | 待测 | 阶段 0 基线 −30% | 生产构建 + `ps` / 性能面板 |
| 渲染进程峰值 RSS（1000 条消息长会话） | 待测 | 阶段 0 基线 −40% | 构造 1000 条消息会话 |
| JS heap 占比（DOM / JS heap / GPU 拆分） | 待测 | — | Chromium heap snapshot |
| 消息列表滚动帧率（长会话） | 待测 | ≥ 55 fps | DevTools Performance |
| 打开 500 条消息会话 TTI | 待测 | ≤ 1.5 s | DevTools Performance |

测量 RSS 时必须使用生产构建。dev 模式下 Vite 不做打包、HMR 与 sourcemap 常驻，bundle 优化在 dev 下的收益无法体现，测出的数字不能作为预算基线。

---

## 四、变更记录

| 日期 | 变更 | 主 bundle | 说明 |
|---|---|---|---|
| 2026-09-21 | 建立基线 | 6,427,730 B | 阶段 0 |
| 2026-09-21 | A1 mermaid 动态化 | 5,416,680 B | `render_mermaid.ts` 静态导入改动态导入；mermaid 核心拆为独立分块 |
| 2026-09-21 | C1 shiki 高亮 Worker 化 | 5,418,781 B | 着色核心抽为 `workspace_highlight_core.ts`，主线程与 Worker 共用；Worker 不可用时回退主线程 |
| 2026-09-21 | D1 空闲 Session 实例回收 | 5,418,781 B | `AgentSessions.release()` + `AgentController.trim_idle_session_runtimes()`；上限 32 个空闲实例 |
| 2026-09-21 | B 分段离屏回收 | 5,423,890 B | 新增 `ChatRetainedSegment.tsx`；按实测高度做等高替换，阈值 3 个分段 |
| 2026-09-22 | 移除 C2 图表渲染预算 | −2,895 B | 删除 `mermaid_render_budget.ts` 与占位 UI；图表一律自动渲染，内存改由滚动懒渲染与 LRU 渲染缓存（32 项）控制 |

### 本轮未做

| 阶段 | 状态 | 说明 |
|---|---|---|
| A2 重库延迟加载实施 | 仅完成评估 | 结论见 PRD 5.1.4：tiptap + prosemirror（786 kB）与 katex（487 kB）值得延迟加载，但需等 TTI 基线才能判断净收益 |

### 待验证（需运行打包产物）

以下三项都无法在开发沙箱内验证（Electron 在沙箱内无法启动），必须在真实桌面上确认。

**1. 高亮 Worker 能否在 `file://` 下创建（优先级最高）**

生产构建用 `loadFile` 走 `file://` 协议，窗口是 `contextIsolation: true` 且未注册自定义协议。

- 若 Worker 可用：着色在主线程之外执行，达到 C1 的预期；
- 若 Worker 创建失败或报错：`workspace_code_highlighter.ts` 会把在途请求回到主线程重跑，**行为与引入 Worker 前一致**，即失去线程隔离但不会失效。

验证方式：打开一个较大的源码文件，在 DevTools 中确认没有 `Failed to construct 'Worker'` 或 CSP 报错。

**2. B 的分段回收效果**

卸载依赖 `IntersectionObserver` 与真实滚动，测试环境没有布局，无法用单元测试证明。需在生产构建中手动验证：

1. 构造 1000 条消息会话，上下滚动后确认离屏分段已卸载（`[data-chat-segment-id]` 容器变空）；
2. 向上浏览时确认没有内容推走又弹回的跳动；
3. 滚回已卸载分段，确认内容重建且滚动位置不偏移；
4. 确认流式分段在生成期间不被卸载。

**3. 运行时 RSS 基线**

第三节全部指标仍为空白，需用生产构建 + heap snapshot 补齐。

---

## 五、运行时约束

以下约束在本轮改动中确立，后续修改相关模块时不得破坏：

### 5.1 Session 实例回收必须先解除订阅

`AgentSessions.release()` 只从缓存移除实例。`AgentController.observe_session` 对已订阅的 key 会提前返回，因此若先释放再解除订阅，重新 `get()` 得到的新实例不会再被订阅，后续 mutation 会静默丢失。释放顺序固定为：解除订阅 → 清理 `runtimes` / `restored_session_models` → `release()`。

### 5.2 空闲回收不能复用 `release_session_projection`

后者同时删除持久化的 Session 模型与推理档位设置，属于删除/归档语义。空闲回收后用户再打开同一会话，模型选择必须原样保留。

### 5.3 高亮 Worker 必须输出 ES 模块

`electron.vite.config.ts` 中的 `worker: { format: "es" }` 不可移除。高亮 Worker 依赖 Shiki 的动态 `import()`（按需加载语言），Vite 默认的 `iife` 不支持代码分割，构建期会直接报错。

### 5.4 高亮结果的新旧由调用方判定

调度层不做「最新请求胜出」：同一时刻可能有两个预览在读不同文件（主视图与右侧文件面板），按全局最新丢弃会让先发的那次永远退化成纯文本。

### 5.5 图表渲染不设单会话数量上限

图表数量本身不设上限。控制内存的手段是滚动懒渲染与 LRU 渲染缓存：未进入视口附近（`render_root_margin` 320px）的图表不渲染，渲染结果按「源码 + 当前主题令牌」缓存 32 项。

曾经按图表标识记账、单会话自动渲染 20 张后转占位（C2），该机制已移除：它在长会话里会拦住用户真正想看的图，而收益仅是少渲染若干张 SVG。若后续要重新引入限制，需要先拿到第三节的 RSS 基线，证明图表确为内存主要来源。

### 5.6 分段回收必须用实测高度

`ChatRetainedSegment` 在卸载前记录分段实测高度，用等高容器替换。`chat.css` 与 `use_chat_scroll.ts` 禁止的是「估算高度占位」，不是占位本身——两者差别在于占位值是否等于真实值。若改成估算高度，原生滚动锚定会立即失效（表现为向上浏览时内容被推走又弹回）。

另外两条不可放宽：流式分段永不回收（高度每帧在变，占位值立刻过期）；分段卸载只在 3 个分段以上的会话启用（卸载会失去离屏内容的 Ctrl+F 与跨分段选择能力）。

### 5.7 图表标识由源码派生，不用 `useId`

`useId` 随组件实例变化，而分段回收会卸载并重建图表组件。用它会让「滚出去再滚回来」被当成一张新图，渲染缓存也用不上。标识改为对源码做散列（`hash_mermaid_source`）。

渲染结果按「源码 + 当前主题令牌」缓存（LRU 32 项），同一张图反复进出视口不重跑 mermaid。Mermaid 的确定性 id 也只由源码与主题令牌决定，不再含渲染位置——位置只用于 Mermaid 内部的临时节点清理，不影响结果正确性。

### 5.8 观察器按滚动容器共享

`ChatRetainedSegment` 不为每个分段各建观察器，而是按滚动容器共享一对（交叉 + 尺寸），分段只做注册与注销。长会话几十个分段时，这能把上百个观察器实例降为两个。

### 5.9 流式期间不因渲染失败而撤回已渲染图表

重新渲染期间保留上一张图（见 `MermaidDiagram.tsx` 顶部注释），只有本轮生成结束（`streaming` 为假）仍失败才撤下它、退回源码。流式中的围栏本来就可能语法不完整，按 chunk 清空会让图表在「出现 → 消失」之间反复。

---

## 六、复核清单

提交涉及以下改动时，按对应项复核：

- 改动 `render_mermaid.ts` 或 mermaid 相关导入 → 复核第二章的 mermaid 符号应为 0；
- 新增第三方依赖到 renderer 入口 → 复核主 bundle 体积未超预算；
- 改动消息列表渲染路径 → 复核运行时预算（第三节，待补齐后）；
- 改动 Session 订阅或释放逻辑 → 复核第五章 5.1 / 5.2 两条约束；
- 改动 `electron.vite.config.ts` → 复核 `worker.format` 仍为 `es`；
- 改动图表渲染路径 → 复核第五章 5.7：图表标识仍由源码派生，`render_mermaid.ts` 仍为动态导入；
- 改动消息分段或滚动逻辑 → 复核第五章 5.6 / 5.8：回收用实测高度、流式不回收、观察器仍共享；
- 升级 `streamdown` / `mermaid` / `shiki` → 复核 chunk 总数与磁盘占用未显著增长。
