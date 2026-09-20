# Desktop 文档预览改版（File Preview）

> 状态：**已实施**。几何与行为的出口是 `features/workspace/components/`，
> 守卫是 `tests/workspace_frontmatter.test.ts`、`tests/workspace_file_link.test.ts`、
> `tests/workspace_file_preview.test.ts`。
>
> 本文回答四个问题：**改了什么**、**为什么这么改**、**各类状态怎么表现**、**下一处改动从哪里取数**。

---

## 一、改动摘要

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 阅读模式入口 | 顶栏常驻「预览 / 源码」分段控件 | 顶栏右侧的文件操作菜单里一项「源码模式」开关 |
| 菜单 | 无 | 源码模式（仅 Markdown）/ 复制全文 / 复制链接 / 用系统默认应用打开 |
| frontmatter | 当正文渲染（分隔线 + 段落） | 解析成结构化元数据卡片，正文从 frontmatter 之后开始 |
| 两个表面 | 各自持有 `useState` 阅读模式，逻辑重复 | 共用 `useWorkspaceFileViewMode` 与同一份菜单组件 |
| 链接构造 | 预览面板没有；diff 卡片自己写了一份 `build_file_link` | 统一为 `lib/workspace/workspace_file_link` |

落地表面：**Chat 右侧「文件」面板**与 **Workspace 主视图文件预览**（两者共用同一套构件）。

---

## 二、为什么去掉常驻的「预览 / 源码」

常驻分段控件有两个问题，都不是审美问题：

1. **占用永久位置换一次性动作。** 绝大多数阅读发生在预览里，切源码是少数动作；
   分段控件让两者看起来同等重要，而它占的是顶栏最贵的横向空间。
2. **它是 Markdown 专属，却常驻顶栏。** 非 Markdown 文件没有这个控件，
   于是顶栏在两类文件之间忽多忽少一件东西——同一位置的元素不稳定，用户每次都要重新确认。

改后两类文件共用同一个菜单，顶栏形状恒定；Markdown 文档只是**多一项**菜单项。

菜单本身沿用应用既有的 `DropdownMenu`（Base UI），并新增一个共享的
`DropdownMenuCheckboxItem`：勾选态由前导对勾表达，不叠选中底色（底色留给「当前所在项」）。
开关项点击后**不关菜单**（与 macOS 菜单一致，用户可以接着执行同一组里的动作），
三个命令项执行后关闭。

### 复制反馈

命令项执行后菜单已关闭，把「已复制」写在菜单项里没人看得见。因此反馈落在**触发按钮**上：
图标换成对勾、无障碍名称同步改成「已复制」，1.2s 后复原——与消息里 diff 卡片复制链接的做法一致。
两个复制动作共用同一个反馈（用户刚点过哪一项自己清楚）。

失败反馈（剪贴板被拒、系统打开失败）显示在按钮**旁边**（`role="status"`，4s）：
失败原因是一句话，塞不进 24px 的图标按钮。

---

## 三、元数据为什么单独解析

frontmatter 此前是「看不见的成本」：它被渲染成一条分隔线加若干段落，于是文件身份
（标题、日期、标签、状态）与内容混在一起，既读不出层级，也分不清哪部分不是正文。

现在由 `lib/workspace/workspace_frontmatter.ts` 拆成**元数据 + 正文**两份数据：

- 元数据 → `WorkspaceFileMetadataCard`（卡片 + `<dl>` 键值表）
- 正文 → 从 frontmatter 之后开始，交给原有的 Markdown 渲染器
- 源码模式 → 仍显示**完整原文**，两种形态不会互相丢失信息

### 解析器只承诺仓库真实出现的形状

| 形状 | 例子 | 结果 |
| --- | --- | --- |
| 标量 | `title: 发布说明` | 一行键值 |
| 带引号标量 | `when: "time:2026-09-20T10:00:00+08:00"` | 去引号，保留内部冒号 |
| 嵌套映射 | `metadata:` + 缩进 `version: 2.0.0` | 展平为 `metadata.version` |
| 行内序列 | `tags: [a, b]` | chip |
| 块序列 | `tags:` + `- a` | chip |
| 块标量 | `description: \|` + 缩进正文 | 原样展示（`raw`） |

**不认识的东西原样展示，不猜。** 无法结构化的字段（块标量、对象序列、更深嵌套）以 `raw`
形式保留，并把 `partial` 置真，卡片底部提示「部分字段无法结构化，已按原文展示」。
丢掉一行元数据比多显示一段原文更难被发现，因此这里刻意偏向保守。

需要完整 YAML 语义（锚点、多文档、复杂流式映射）时应换成真正的 YAML 解析器：
替换点只有 `parse_workspace_document` 一处，调用方不感知解析细节。

### 一个有意保留的边界

frontmatter 以第一个独立 `---` 行结束，因此块内不能再出现独立 `---` 行（标准 frontmatter 语义即如此）。
文件不以 `---` 开头、或没有成对的结束行时，整份文件按正文处理——这条约束是为了不吞掉
「以分隔线开头的普通文档」，否则用户会看到整篇内容消失、只剩一张元数据卡片。

---

## 四、视觉与几何

| 项 | 取值 | 依据 |
| --- | --- | --- |
| 卡片表面 | `bg-surface-subtle` + `rounded-surface` + `px-3.5 py-3` | 「与背景略有区分」的默认档；与 Plugin 说明卡片同一档 |
| 卡片与正文间距 | `mb-3`（12px） | 与应用「块接块」的既有档位一致（消息内块间距），且大于文档内部正文档（7.5px） |
| 字段名列 | `minmax(4.5rem, 32%)` | 用 `auto` 时超长字段名会撑到 max-content，把值列挤成 0 宽且不报错 |
| 字段名 | `font-mono` + `text-2xs` + `truncate`（`title` 留全文） | 点分名（`metadata.version`）等宽体读起来是一个整体 |
| 值 | `text-xs leading-5` | 次要正文档；元数据不是内容主体 |
| 序列 | `rounded-full bg-surface-emphasis` chip，自动换行 | 标签这类并列短词；emphasis 是「位于上述表面之上」的合法档位 |
| 无法结构化 | `<pre>` 等宽原文块，`bg-surface-emphasis` | 与「这是原文」这件事在视觉上一致 |
| 空值 | `—` | 留白会被读成「没有值」与「渲染失败」两种意思 |

所有取值都来自现有语义令牌（`tokens.css` / `semantic-colors.css`），没有新增任意透明度或字号。

---

## 五、状态清单

| 状态 | 表现 |
| --- | --- |
| 读取中 | 居中转圈 + 「正在读取文件」（`WorkspaceFilePlaceholder`） |
| 读取失败 | 居中提示块显示后端原因（超过 2 MB、二进制文件、路径越界…） |
| 无 frontmatter | 不渲染卡片，正文占满（`entries` 为空即不渲染） |
| 元数据部分不可解析 | 卡片底部提示一句，不阻塞阅读 |
| 非 Markdown | 无源码模式开关，顶栏与菜单形状不变 |
| 文件未读到 | 不渲染操作菜单（「复制全文」此时只能复制空字符串） |
| Workspace 未登记 | 菜单里不渲染「用系统默认应用打开」（置灰项无法弹出解释，等于给一个不能点又不知为何不能点的动作） |
| 复制成功 | 触发按钮图标换对勾，1.2s 复原；无障碍名称同步改「已复制」 |
| 复制 / 打开失败 | 按钮旁 `role="status"` 显示原因，4s 后消失 |
| 带行号的链接 | 初始进源码视图并滚动到该行居中高亮；用户随后可切回预览 |

---

## 六、响应式与无障碍

- **窄面板（Chat 侧栏，最小 360px）**：路径 `min-w-0 flex-1 truncate`，菜单按钮 `flex-none`，
  窄窗口下先牺牲路径、按钮始终完整可点。元数据卡片两列网格仍成立（名称列上限 32%）。
- **主视图顶栏**：路径与菜单同处 title 内容区（内容宽度），因此**不能**给路径 `flex-1`
  （basis 0 会把它压成零宽）。路径靠 `min-w-0 truncate` 让位。
- **键盘**：菜单走 Base UI 的 `role="menu"` 语义（方向键、Home/End、Esc、文字跳转）。
  触发器是 `<button>`，焦点环 `focus-visible:ring-2 ring-ring/30` 与其它次级图标按钮同一条。
- **读屏**：元数据用 `<dl>`，字段名与值成对朗读；卡片由 `aria-labelledby` 指向「文档元数据」；
  操作菜单按钮的无障碍名称是「{{路径}} 文件操作」；复制反馈与错误都通过 `role="status"` 播报。
- **对比度**：全部沿用现有令牌（`--muted-foreground` 在页面背景上 ≥4.5:1），未引入新的低对比灰。

---

## 七、下一处改动从哪里取数

| 要改什么 | 改哪里 |
| --- | --- |
| frontmatter 支持的形状 | `lib/workspace/workspace_frontmatter.ts` + `tests/workspace_frontmatter.test.ts` |
| 初始阅读模式规则 | `resolve_default_view_mode`（`lib/workspace/workspace_file_preview.ts`） |
| 链接 / 绝对路径格式 | `lib/workspace/workspace_file_link.ts`（反向解析在 `features/navigation/lib/desktop_link.ts`） |
| 菜单项 | `features/workspace/components/WorkspaceFileActionsMenu.tsx` |
| 元数据视觉 | `features/workspace/components/WorkspaceFileMetadata.tsx` |
| 文案 | `locales/{zh,en}/resources.json` 的 `workspace.*` |

---

## 八、已知取舍

1. **frontmatter 解析器不是完整 YAML。** 代价是复杂文档的部分字段按原文展示。
   收益是零依赖、可单测、行为可预测。若将来文档普遍使用锚点或对象序列，应换成真实解析器
   （替换点单一，调用方不感知）。
2. **「用系统默认应用打开」= 系统双击行为。** `.md` 可能进编辑器、图片进预览器，
   这取决于用户系统关联，应用不做二次判断。需要「在 VS Code 中打开」时应另加菜单项，
   不复用这一个（两者语义不同，用户预期也不同）。
3. **元数据卡片不折叠。** 元数据通常只有几行，折叠等于多按一次才能确认「这份文件是什么」；
   为少数超长值引入逐个展开器成本高于收益。
