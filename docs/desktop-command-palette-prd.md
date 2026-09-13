# Desktop 命令面板（Command Palette）PRD

> 状态：待评审（尚未实施；本文档只定义交付合同，不含已落地代码）
>
> 参考实现：`duobox/app/src/renderer/lib/command-palette/`、`duobox/app/src/renderer/lib/palette/`、`duobox/app/src/renderer/lib/shortcuts/`
>
> 目标范围：
>
> - 新增 `app/desktop/src/renderer/features/command-palette/`
> - 修改 `app/desktop/src/renderer/app/DesktopShell.tsx`（删除现有占位面板）
> - 修改 `app/desktop/src/renderer/components/ui/dialog.tsx`（增加模态探针标记）
> - 修改 `app/desktop/src/renderer/types/DesktopView.ts` 与 `app/desktop/src/renderer/app/use_desktop.ts`（新增 `report_error` action）
> - 修改 `app/desktop/src/renderer/locales/{en,zh}/common.json`
> - 新增 `app/desktop/tests/command_palette_*.test.ts`
>
> 文档性质：可执行的产品与工程交付合同。目标是让 Desktop 拥有一个键盘优先、可扩展、与现有 7 个 domain store 边界一致的命令面板，而不是把 duobox 的目录结构照搬过来。

---

## 一、结论摘要

### 1.1 现状

Desktop 已经存在一个占位意义上的"命令面板"，但它是残缺的：

`app/desktop/src/renderer/app/DesktopShell.tsx` 中通过本地 `useState` 维护 `command_palette_open`，`⌘/Ctrl+P` 打开，然后渲染两个硬编码按钮：

```text
打开设置      ⌘,
切换左侧边栏  ⌘B
```

它没有搜索、没有键盘导航、没有分组、没有无障碍语义、不能扩展，并且把 `command_palette.open_settings` / `command_palette.toggle_sidebar` 两条文案写死在 `common` 命名空间里。同时 `features/settings/SettingsView.tsx` 的"快捷键"页面已经对外声明了"打开命令面板 ⌘ / Ctrl + P"，也就是说**产品承诺已经存在，实现没有兑现**。

### 1.2 本次要做的事

用一套可注册、可扩展、状态完整、可测试的命令系统替换这个占位实现：

1. 新增 `features/command-palette/` 模块，包含命令注册表、命令搜索、面板 UI、内置命令提供者。
2. 内置约 20 条命令，覆盖导航、跳转、新建、当前会话、外观、账户六个分组。
3. 支持 4 个数据驱动的子页面（Workspace、Agent、会话、Plugin），采用"进入子页面 / 返回根页面"的两层结构。
4. 命令面板不执行任何不可逆操作。
5. 补齐键位文案、i18n、无障碍语义、状态与边界测试。

### 1.3 本次明确不做的事

| 不做 | 原因 |
| --- | --- |
| 快捷键注册表（shortcut registry）、作用域、优先级、可发现目录 | 这是独立且更大的概念。Desktop 当前的键盘处理集中在 `DesktopShell` 的一个 capture 监听器里，重构它会牵动业务页面的键位语义。见 6.6。 |
| Plugin 通过贡献点注册命令 | Desktop 的 Plugin 目前只提供 Sidebar / Mainview / Config / MCP，没有 UI 贡献点（`ui.use("command.palette")` 这类接口在 Desktop 不存在）。先建立宿主命令，再设计贡献协议。 |
| 会话的跨 Workspace 全量搜索 | 会话数量无上界，且需要跨 Workspace 聚合与异步读取。P0 只做"当前 Workspace 的会话"。 |
| 使用频率排序（MRU / 最近使用） | 没有真实使用数据就无法校准衰减策略；确定性的顺序可预测、可测试、可解释。先不做。 |
| 拼音 / 首字母搜索 | 需要词典依赖（体积 + 维护）。P0 对中文使用子串匹配，并把它作为已知限制记录在 13.1。 |
| 破坏性命令（退出登录、删除 Agent / Group / Workspace / 会话、清空 Global Env） | 面板是"快速、低摩擦"的表面，不可逆动作需要经过有上下文的页面与二次确认。规则见 7.5。 |
| 移动端 / 触屏布局 | Desktop 是 Electron 桌面应用，键盘与鼠标是唯一输入前提。见 10.1。 |

### 1.4 关键决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 目录位置 | `features/command-palette/`，不用 duobox 的 `lib/command-palette/` | Desktop renderer 的事实分层是 `features/<domain>/{types,lib,state,components,hooks}`。命令面板是一个功能域，不是通用工具库。 |
| 触发键 | 保留 `⌘/Ctrl+P`，不采用 duobox 的 `Mod+Shift+P` | Settings > Shortcuts 已对外文档化 ⌘P；Desktop 没有文档搜索面板，⌘P 无冲突；`⌘P` 在 Electron 默认菜单中没有被占用（`src/main/index.ts` 未注册自定义菜单，`autoHideMenuBar: true`）。风险与回退见 13.4。 |
| 面板打开状态放在哪 | 继续留在 `DesktopShell` 的本地 state，不新增第 8 个 store | 只有一个消费者（面板自己），且它属于 shell chrome 而非领域状态。提升到 navigation store 会让每次侧栏折叠都通知全部导航订阅者。 |
| 列表实现 | 不引入 `cmdk`，自建受控 listbox | Desktop 当前依赖树里没有 `cmdk`；面板需要"禁用项保留可见""两级页面""确定性排序"，而 cmdk 的内置过滤会与之竞争。需要一个 `role="combobox"` + `role="listbox"` + `aria-activedescendant` 的窄接口，自建成本可控。替代方案见 13.6。 |
| 命令注册表形态 | 模块级单体 external store（与 duobox 一致），不进 `controller.stores` | 命令由多个不相邻的组件贡献，且天然是应用级全局目标。塞进 domain store 会模糊"7 个 domain store"的所有权契约。 |
| 错误反馈 | 复用现有全局错误条，新增 `DesktopActions.report_error(error: unknown)` | 面板执行失败必须可见。Desktop 没有 toast 系统，`DesktopErrorHost` 已经在读 `settings.error`；但它目前没有对外的写入 action 供命令使用。 |
| 子页面 | 采用 duobox 的两层页面机制，P0 只开放 4 个有界页面 | 让"跳转类命令"承载数据，避免根列表被上百条会话污染。 |

---

## 二、背景

### 2.1 duobox 参考实现的实际结构

读代码而非读印象，duobox 的命令面板由四块组成：

```text
lib/command-palette/
  model.ts                    CommandContext / CommandDefinition
  registry.ts                 CommandRegistry（Map + listeners + snapshot + 重复 id 抛错）
  useCommands.ts              useRegisterCommands / useCommands（useSyncExternalStore）
  CommandProviders.tsx        内置命令提供者：navigation / space / environment / view / appearance
  ExtensionCommandAdapter.tsx 把扩展贡献点映射成命令
  CommandPalette.tsx          面板 UI（cmdk，分组渲染、快捷键解析、子页面）
  index.ts
lib/palette/
  store.ts                    activePalette / commandPage / query
  DocSearchPalette.tsx        另一个并列面板（文档搜索）
lib/shortcuts/
  types.ts / registry.ts / provider.tsx / AppShortcuts.tsx / catalog.ts
                              快捷键注册表：scope、priority、matchesShortcut、formatShortcutDisplay
```

值得直接继承的部分：

- 命令是**数据**（`CommandDefinition`），不是组件；`run` 是命令的唯一副作用出口。
- `when` 决定"是否存在"，`enabled` 决定"是否可执行"，两者分开。
- 注册返回注销函数，由 `useEffect` 的清理阶段调用，因此与 React StrictMode 的双次执行兼容。
- `id` 冲突必须被显式发现，不能静默覆盖。
- 子页面通过命令的 `closeOnRun: false` + 页面状态实现，而不是引入路由。

需要修正而不是照搬的部分见 2.3。

### 2.2 Desktop 现状（与本次相关的部分）

```text
app/desktop/src/renderer/
  app/DesktopShell.tsx                   占位面板 + 唯一的全局 keydown 监听器
  app/use_desktop.ts                     组合 7 个 domain store 与 DesktopActions
  types/DesktopView.ts                   NavigationTarget / SidebarMode / DesktopActions
  lib/store.ts                           use_store / use_store_selector（useSyncExternalStore 基元）
  features/navigation/lib/sidebar_shortcut.ts
                                         order_rail_plugins / resolve_sidebar_shortcut_mode
  features/settings/SettingsView.tsx     Settings > Shortcuts 已经文档化 ⌘P
  components/ui/menu-styles.ts           menu_surface / menu_item / menu_label / menu_shortcut 类名
  components/ui/dialog.tsx               Base UI Dialog 封装
  locales/{en,zh}/*.json                 6 个命名空间，en/zh key 必须完全一致（有测试强制）
```

已有的可复用能力：

- `controller.actions` 已经提供几乎全部所需动作：`set_sidebar_mode`、`open_settings`、`close_settings`、`select_workspace`、`open_agent_chat`、`select_session`、`create_session`、`open_create_agent`、`open_create_group`、`select_plugin_workspace`、`archive_session`、`stop_session`、`refresh_models`、`update_settings`。
- `use_desktop_selector(store, selector)` 提供按最小切片订阅。
- `order_rail_plugins()` 是 Sidebar Rail 顺序与 `⌘1..9` 映射的唯一事实源，Plugin 页面子列表必须复用它，否则会出现"面板里的顺序和侧栏不一样"。
- `menu_styles.ts` 已经定义了 Duobox 视觉系统下的菜单表面、菜单项、分组标签、快捷键文本的类名。

### 2.3 直接照搬会出问题的地方

1. **目录与命名系统不同。** duobox 用 camelCase（`closeOnRun`、`currentSpaceId`），Desktop 的领域类型与 props 一律 snake_case（`has_sidebar`、`workspace_id`、`open_create_agent`）。照搬会立即破坏仓库的一致性规则。本文档统一使用 snake_case。
2. **依赖不同。** duobox 面板建立在 `cmdk` + `@/components/ui/command` 之上；Desktop 两者都没有。要么新增依赖，要么自建列表语义。见 1.4 与 13.6。
3. **store 体系不同。** duobox 用 zustand 承载 `activePalette` / `commandPage` / `query`；Desktop 的等价物是 `use_store`。但面板状态只有一个消费者，引入 store 是多余概念。P0 用 `useState`，并在关闭时复位。
4. **错误出口不同。** duobox 有 `toast`；Desktop 只有全局错误条，且没有对外的写入 action。必须补 `report_error`，否则命令失败会静默。
5. **快捷键体系不同。** duobox 的 `shortcutId` 指向快捷键注册表；Desktop 没有注册表，`Settings > Shortcuts` 里的键位是手写字符串。P0 的折中方案见 6.6，这个折中本身也需要被记录，否则日后会漂移成第二份事实源。

---

## 三、目标与非目标

### 3.1 目标

D1. 用户在任意页面可以用一个键位唤起统一入口，并在 3 次按键内完成"切 Workspace / 切会话 / 新建对话 / 打开设置 / 切主题"。

D2. 面板只暴露当前上下文真正可执行的命令；不可执行的原因对用户可见，而不是命令凭空消失或点了没反应。

D3. 命令是声明式数据，新增一条命令不修改面板组件；命令来源之间的 ID 冲突在开发期立即暴露。

D4. 面板的所有状态（默认、悬停、键盘高亮、禁用、选中、空结果、加载、失败、两级页面）都有明确定义与视觉表达。

D5. 面板完全可键盘操作，具备正确的 listbox / combobox 无障碍语义，9 个主题下文本对比度达标。

D6. 不新增运行时依赖；纯逻辑（注册表、排序、键位格式化）可被 `node --test` 直接测试。

### 3.2 成功标准（可验证）

| 编号 | 标准 | 验证方式 |
| --- | --- | --- |
| S1 | `⌘/Ctrl+P` 在任意业务页面（含设置页、Plugin 工作区、会话页）打开面板，输入框在同一次渲染内获得焦点 | 手动验收（Electron 真机） |
| S2 | 面板打开时按 `Esc` 只关闭面板；在子页面中按 `Esc` 只返回根页面；均不影响设置页自身的 `Esc` 返回行为 | 手动验收 + 键位优先级表（7.2） |
| S3 | 300 条候选、10 字符查询下，`filter_and_rank` 单次调用 < 2 ms | Node 基准脚本，记录在测试输出 |
| S4 | 根页面命令数量 ≤ 24，任一命令最多 2 次键盘操作可达 | 命令清单审查（5.1） |
| S5 | 面板不提供任何不可逆命令 | 命令清单审查 |
| S6 | `pnpm -C app/desktop test` 全绿，含新增 3 个测试文件 | CI / 本地 |
| S7 | `pnpm -C app/desktop typecheck` 通过（node + web 两份 tsconfig） | CI / 本地 |
| S8 | en / zh key 完全一致、无空文案 | `desktop_i18n.test.ts` |
| S9 | 9 个主题（duobox / dim / forest / graph / haze / mono / ocean / sunset / vercel）下，命令标题与背景对比度 ≥ 4.5:1 | 逐主题手动检查 |
| S10 | `package.json` 的 `dependencies` 不新增条目 | diff 审查 |

---

## 四、用户与场景

### 4.1 目标用户

- **重度键盘用户**：在多个 Workspace 与多个 Agent 之间频繁切换，讨厌移动鼠标去找侧栏里的条目。
- **多 Agent 使用者**：同一 Workspace 下有十几到几十个会话，侧栏列表需要滚动与目视搜索。
- **正在学习产品的新用户**：不知道某个能力藏在哪里，用命令面板"按名字找功能"。

### 4.2 核心场景

| 场景 | 触发 | 期望结果 |
| --- | --- | --- |
| 记不住设置入口在哪 | 任意页面 `⌘P` → 输入"主题" → `↵` | 进入外观设置 |
| 在两个 Workspace 之间来回切 | `⌘P` → 输入 Workspace 名的一部分 → `↵` | 切到目标 Workspace 并沿用其上次页面 |
| 回到某个 Agent 的某个会话 | `⌘P` → "会话" → 输入标题片段 → `↵` | 打开该会话 |
| 想快速开始一段新对话 | `⌘P` → `↵`（首项为"新建对话"） | 进入当前上下文的 Draft |
| 试用某个 Plugin | `⌘P` → "插件" → `↵` | 进入该 Plugin 工作区 |
| 正在流式输出想立刻停 | `⌘P` → 输入"停止" → `↵` | 停止当前 Session 执行 |

### 4.3 关键假设

A1. 面板是"加速器"，不是唯一入口。所有命令对应的能力在界面上都有常规入口；面板消失不会导致能力不可达。

A2. 用户已经知道（或从 Settings > Shortcuts 得知）`⌘P`。P0 不额外做首次发现引导。

A3. 面板打开期间应用数据不变或变化可接受；面板不订阅高频流式 store，打开期间不做异步加载（"会话"子页面读取已水合的导航索引）。

A4. 面板是模态的：打开期间不响应下方的业务键盘操作。

---

## 五、信息架构

### 5.1 命令清单（P0 全部命令）

分组顺序即视觉顺序，由 `command_group_order` 常量固定：

```ts
const command_group_order = ["navigation", "goto", "create", "chat", "appearance", "account"] as const;
```

#### navigation — 导航

| id | 标题（zh） | 快捷键展示 | 行为 | when |
| --- | --- | --- | --- | --- |
| `nav.open-chat` | 打开 Chat | ⌘1 | `set_sidebar_mode("chat")` | 总是 |
| `nav.open-workspace` | 打开 Workspace | ⌘2 | `set_sidebar_mode("workspace")` | 总是 |
| `nav.open-plugins` | 打开 Plugins | ⌘3 | `set_sidebar_mode("plugins")` | 总是 |
| `nav.open-plugin-view` | 打开 Plugin… | — | 进入 `plugins` 子页面 | 存在 `has_sidebar && has_mainview` 的 Plugin |
| `nav.toggle-sidebar` | 显示侧栏 / 隐藏侧栏 | ⌘B | `shell.toggle_sidebar()` | 总是 |
| `nav.open-settings` | 打开设置 | ⌘, | `open_settings("user")` | 总是 |
| `nav.back-from-settings` | 返回上一个页面 | Esc | `close_settings()` | `selection.kind === "settings"` |

说明：`nav.toggle-sidebar` 的标题随 `shell.sidebar_collapsed` 变化（与 duobox 的 appearance 组做法一致）。

#### goto — 跳转

| id | 标题（zh） | 行为 | trailing | when / enabled |
| --- | --- | --- | --- | --- |
| `goto.workspace` | 切换 Workspace… | 进入 `workspaces` 子页面 | `TbChevronRight` | 总是 |
| `goto.session` | 切换会话… | 进入 `sessions` 子页面 | `TbChevronRight` | `active_workspace_id` 非空 |
| `goto.agent` | 打开 Agent… | 进入 `agents` 子页面 | `TbChevronRight` | `agents.length > 0` |

#### create — 新建

| id | 标题（zh） | 快捷键展示 | 行为 | when |
| --- | --- | --- | --- | --- |
| `create.conversation` | 新建对话 | ⌘R | 与 `⌘R` 现有逻辑一致（Group / Agent 分支） | `selection` 存在且非设置页 |
| `create.agent` | 新建 Agent | — | `open_create_agent()` | 总是 |
| `create.group` | 新建 Group | — | `open_create_group()` | 总是 |
| `create.workspace` | 新建 Workspace | — | `shell.open_create_workspace()` | 总是 |

`create.conversation` 必须复用 `⌘R` 的既有语义，不能另写一套。实现方式：把 `DesktopShell` 中现有的 `⌘R` 分支体提炼为 `create_conversation_in_context()` 本地函数，键位处理与命令 `run` 共同调用它。这是消除"面板顺序/侧栏顺序不一致"这类漂移的结构性做法。

#### chat — 当前会话（仅在与会话相关的页面上出现）

| id | 标题（zh） | 行为 | when / enabled |
| --- | --- | --- | --- |
| `chat.stop` | 停止当前执行 | `stop_session(...)` | `enabled`: 当前 Session 的 runtime `is_chat_busy` |
| `chat.archive` | 归档当前会话 | `archive_session(...)` | `selection.kind === "session"` |
| `chat.load-earlier` | 加载更早历史 | `load_earlier_history(...)` | `history.has_more` |

`chat.*` 组的 `when` 条件需要读取当前 Session 的 key。实现上通过 `context` 扩展一个 `active_session` 字段（见 6.2），由面板在构建 context 时从导航与会话 store 解析，避免命令自己去猜当前会话。

#### appearance — 外观

| id | 标题（zh） | 行为 |
| --- | --- | --- |
| `appearance.toggle-mode` | 切换到深色 / 切换到浅色 | `update_settings({ appearance_mode })`，在 light / dark 之间翻转 |
| `appearance.open-settings` | 外观设置 | `open_settings("appearance")` |

`appearance.toggle-mode` 只在当前 `appearance_mode` 是 `light` 或 `dark` 时出现；为 `system` 时标题为"切换到深色"（可预期地离开 system）。

#### account — 账户与模型

| id | 标题（zh） | 行为 | when |
| --- | --- | --- | --- |
| `account.refresh-models` | 刷新模型目录 | `refresh_models()` | 已登录 |
| `account.open-models` | 模型设置 | `open_settings("models")` | 总是 |
| `account.open-user` | 账户与用量 | `open_settings("user")` | 总是 |

统计：单个根页面**同时可见**的命令最多 22 条（会话页面下：导航 6 + 跳转 3 + 新建 4 + 当前会话 3 + 外观 2 + 账户 3 + 设置页专属 1），满足 S4。

### 5.2 子页面

| 页面 | 数据源 | 行主文案 | 行副文案 | 选中行为 | 规模上界 |
| --- | --- | --- | --- | --- | --- |
| `workspaces` | `catalog.workspaces` | `name` | `workspace_path`（中间省略） | `select_workspace(workspace_id)` | 无硬上界，实测 < 50 |
| `agents` | `catalog.agents` | `name` | `description` | `open_agent_chat(agent_id)` | 无硬上界，实测 < 50 |
| `sessions` | `session.sessions_by_workspace[active_workspace_id]` | `session.title` | `agent.name · 相对时间` | `select_session(workspace_id, agent_id, session_id)` | **按 `updated_at` 倒序取前 200 条** |
| `plugins` | `order_rail_plugins(catalog.plugins)` | `title` | `description` | `select_plugin_workspace(plugin_id)` | 有硬上界（Rail 语义上 ≤ 9 个） |

子页面共同规则：

- 每个子页面都是**同一面板的第二页**，不打开新窗口，不改变应用布局。
- 当前项（当前 Workspace / 当前会话 / 当前 Agent）用尾部 `TbCheck` 标记，并设 `aria-current="true"`。
- `sessions` 子页面的页头提示显示当前 Workspace 名称，格式 `command_palette.page.sessions_scope`（`当前 Workspace：{{name}}`）。没有这一行，用户无法判断"为什么搜不到另一个 Workspace 的会话"。
- `plugins` 子页面展示 `⌘4`…`⌘9` 的键位提示，与 Rail tooltip 使用同一份 `order_rail_plugins` 顺序。

### 5.3 数据来源与规模

- 根页面命令：静态注册，数量恒定，同步可用，不做加载态。
- `sessions` 子页面数据来自 `session` store 的导航索引，该索引在应用启动时已异步水合。因此存在"索引尚未就绪"的中间态，必须显示加载行（见 7.7 S6），不能显示"暂无会话"这种错误结论。
- **面板不订阅 `chat_stream`。** 唯一需要它的判断是 `chat.stop` 的 `enabled`，改为在面板打开/context 变化时通过 `controller.stores.chat_stream.get_snapshot()` 同步读取一次，避免高频 store 让面板每帧重渲染。

---

## 六、架构设计

### 6.1 文件清单

```text
app/desktop/src/renderer/features/command-palette/
  types.ts                CommandGroupId / CommandContext / CommandDefinition / CommandPage
  registry.ts             CommandRegistry + command_registry 单体
  use_commands.ts         use_register_commands / use_commands
  filter.ts               纯函数 filter_and_rank
  shortcut_display.ts     纯函数 detect_shortcut_platform / format_shortcut
  CommandProviders.tsx    6 组内置命令的注册（4 个 hook）
  CommandPalette.tsx      面板外壳：浮层、输入、键盘、分组渲染、页脚
  CommandPageList.tsx     4 个数据驱动子页面的行渲染
  index.ts                对外只导出 CommandProviders 与 CommandPalette
```

不新增 `state/` 目录：面板状态由 `CommandPalette` 内部 `useState` 持有（1.4）。

### 6.2 数据模型

```ts
// types.ts
import type { ReactNode } from "react";
import type { NavigationTarget, SidebarMode } from "@/types/DesktopView";

/** 命令分组；顺序由 command_group_order 固定。 */
export type CommandGroupId = "navigation" | "goto" | "create" | "chat" | "appearance" | "account";

/** 面板当前页面。 */
export type CommandPage = "root" | "workspaces" | "agents" | "sessions" | "plugins";

/** 当前 Session 的最小解析结果；解析失败时为 null。 */
export interface CommandActiveSession {
  workspace_id: string;
  agent_id: string;
  session_id: string;
  is_draft: boolean;
  is_busy: boolean;
  has_more_history: boolean;
}

/** 命令求值时可见的导航上下文；只含只读投影，不携带 store。 */
export interface CommandContext {
  sidebar_mode: SidebarMode;
  active_workspace_id: string;
  selection_kind: NavigationTarget["kind"] | null;
  active_session: CommandActiveSession | null;
  visible_plugin_count: number;
}

/** 一条可注册命令。 */
export interface CommandDefinition {
  /** 全局唯一；冲突在开发期抛错。 */
  id: string;
  /** 用户可见标题；必须来自 i18n。 */
  title: string;
  /** 所属分组。 */
  group: CommandGroupId;
  /** 搜索关键词；必须包含中英文别名、能力同义词与命令 id 片段。 */
  keywords?: readonly string[];
  /** 分组内排序；数字小的靠前。 */
  order?: number;
  /** 左侧图标；尺寸由渲染层统一约束为 16px。 */
  icon?: ReactNode;
  /** 右侧键位展示文本；由 format_shortcut 生成或写死为 "Esc"。 */
  shortcut?: string;
  /** 右侧尾部装饰；子页面入口使用 TbChevronRight。 */
  trailing?: ReactNode;
  /** 不存在时整条命令不出现。 */
  when?: (context: CommandContext) => boolean;
  /** 存在但不可执行时置灰。 */
  enabled?: (context: CommandContext) => boolean;
  /** 置灰时的原因，展示在行内供屏幕阅读器与悬停读取。 */
  disabled_reason?: string;
  /** 执行命令。true = 关闭面板；默认关闭。返回 false 表示留在面板内。 */
  run: (context: CommandContext) => boolean | void | Promise<boolean | void>;
}
```

与 duobox 的差异及理由：

- `close_on_run` 被替换为 `run` 的返回值。理由：布尔字段与"留在面板内"这一行为分散在两处，返回值让语义在同一个地方表达，且减少一个字段。
- 新增 `disabled_reason`。duobox 的禁用项只置灰，用户不知道为什么。对"停止当前执行"这类命令，原因（"当前没有正在执行的 Turn"）比禁用本身更有信息量。
- `keywords` 从 `string[]` 收紧为 `readonly string[]`，与 Desktop 现有只读数组习惯一致。
- `CommandContext` 只含投影数据，**不含 `actions`**。命令在注册时通过闭包捕获 `controller.actions`，因此 context 保持可纯函数化、可测试。

### 6.3 命令注册表

```ts
// registry.ts
export class CommandRegistry {
  register(commands: readonly CommandDefinition[]): () => void;
  get_snapshot(): readonly CommandDefinition[];
  subscribe(listener: () => void): () => void;
}
export const command_registry = new CommandRegistry();
```

契约（与 duobox 一致，但补齐了生产环境行为）：

1. `get_snapshot()` 返回的数组引用在无变更时必须稳定。实现内部缓存 `snapshot`，仅在 `emit` 时重建。这是 `useSyncExternalStore` 的硬要求；Desktop 的 `lib/store.ts` 注释里已经写明了同类告警。
2. `subscribe` 返回注销函数。
3. `register` 返回注销函数；注销只删除本次注册的 id。
4. `register([])` 是空操作，不触发通知。
5. **id 冲突**：
   - 开发构建（`import.meta.env.DEV`）：抛出 `Duplicate command id: <id>`。新命令接入时立刻暴露。
   - 生产构建：`console.error` 并跳过冲突项（保留先注册者），不抛出。
   - 理由：注册错误发生在 `useEffect` 里，抛出会让整棵子树渲染失败、应用白屏。开发期需要响亮，生产期需要降级。这一条是对 duobox 行为的刻意偏离，避免把"开发期便利"换成"线上白屏风险"。

### 6.4 命令来源

```ts
// use_commands.ts
export function use_register_commands(
  create_commands: () => readonly CommandDefinition[],
  dependencies: React.DependencyList,
): void;

export function use_commands(context: CommandContext): readonly RankedCommand[];
```

- `use_register_commands` 在 `useEffect` 中注册并返回注销函数，因此 React StrictMode 的双次执行（`main.tsx` 使用 `<React.StrictMode>`）会得到 注册 → 注销 → 注册 的正确序列。
- `use_commands` 通过 `useSyncExternalStore` 订阅注册表，再对 `context` 做一次 `useMemo` 求值：先按 `when` 过滤，再标注 `is_enabled`。
- 快照的排序（group 顺序、`order`、title）在 `filter_and_rank` 内完成，不在选择器里排序；选择器与订阅只做投影。

### 6.5 与 DesktopShell / controller 的边界

`DesktopShell` 新增一个 shell 环境对象，作为 prop 传入面板与命令提供者：

```ts
interface ShellCommandEnvironment {
  sidebar_collapsed: boolean;
  toggle_sidebar(): void;
  open_create_workspace(): void;
  create_conversation_in_context(): void;
  report_error(error: unknown): void;
  has_open_modal(): boolean;
}
```

所有权说明：

- `sidebar_collapsed` 与 `create_workspace_dialog_open` 是 shell chrome 状态，留在 `DesktopShell`，不进 store。
- `create_conversation_in_context()` 是从现有 `⌘R` 分支提炼出来的唯一实现，供键位与命令共用。
- `report_error` 需要新增到 `DesktopActions`（见 6.5.1）。
- `has_open_modal()` 属于"当前是否有更高优先级的模态"，由 shell 提供，使 `⌘P` 的守卫与 `Esc` 的优先级集中在一处。

#### 6.5.1 新增 `DesktopActions.report_error`

```ts
// types/DesktopView.ts
/** 把一次用户可见的失败上报到全局错误条。 */
report_error(error: unknown): void;

// use_desktop.ts
report_error: settings.set_error.bind(settings)  // 内部统一用 to_error_message 归一化
```

理由：面板在 `run` 里 `catch` 到的异常必须让用户看见。当前 `DesktopActions` 只有 `clear_error`，没有任何写入通道；不补这个 action，面板只能 `console.error`，等于静默失败。命名用 `report_error` 而不是 `set_error`，表达"上报事实"而不是"篡改状态"。

### 6.6 与快捷键的关系

Desktop 当前的键位处理是 `DesktopShell` 内一个 capture 阶段的 `window.keydown` 监听器，加上 `features/navigation/lib/sidebar_shortcut.ts` 的数字映射。没有注册表、没有 scope、没有优先级。

**P0 决策：不引入快捷键注册表。** 面板只做两件事：

1. 通过 `shortcut_display.ts` 的 `format_shortcut(keys, platform)` 生成展示文本。
2. 在 `CommandProviders` 附近维护一张**只读的展示映射**，把命令 id 映射到键位数组：

```ts
const command_shortcuts: Partial<Record<string, readonly string[]>> = {
  "nav.open-chat": ["Mod+1"],
  "nav.open-workspace": ["Mod+2"],
  "nav.open-plugins": ["Mod+3"],
  "nav.toggle-sidebar": ["Mod+B"],
  "nav.open-settings": ["Mod+,"],
  "create.conversation": ["Mod+R"],
  "nav.back-from-settings": ["Escape"],
};
```

**必须记录的取舍：** 这张表会成为第二份键位事实源。为把漂移风险压到最低，采取三条约束：

- 表里只放 `DesktopShell` 现有分支与 `resolve_sidebar_shortcut_mode` 已经实现的键位，**不新增任何键位**。面板不发明快捷键。
- `command_shortcuts` 与 `DesktopShell` 的键位分支必须在同一个 PR 内成对修改；`app/desktop/tests/command_palette_shortcut.test.ts` 对表做快照断言，键位被改动时测试失败，强制修改者回到 shell 里同步。
- **P1 必须收敛**：引入 6.6 之外的快捷键目录（`features/shortcuts/`），让 `Settings > Shortcuts` 与命令面板从同一份数据读键位，并让 `DesktopShell` 的监听器按该目录派发。届时删除 `command_shortcuts`。这一项写入 15.2 的后续阶段，不允许无限期悬置。

`Settings > Shortcuts` 的"打开命令面板 ⌘P"条目维持不变。

---

## 七、交互规格

### 7.1 打开与关闭

**打开**

- 全局 `⌘/Ctrl+P`。守卫条件必须同时成立：
  1. `!event.isComposing`
  2. 未按下 `Shift` / `Alt`（修正现有实现：当前 `modifier && event.key.toLowerCase() === "p"` 会被 `⌘⇧P`、`⌘⌥P` 命中）
  3. `!shell.has_open_modal()`
- 打开时：记录 `document.activeElement` 作为恢复目标 → 设置 `open = true` → 复位 `page = "root"`、`query = ""` → `useLayoutEffect` 中聚焦输入框。
- 打开的过渡：面板本身无入场动画（Duobox 的菜单动效只用于 `MenuSurface` 的 data-open 状态；命令面板是覆盖层，出现即完成）。

**关闭**

| 途径 | 行为 |
| --- | --- |
| `Esc`（根页面） | 关闭面板 |
| `Esc`（子页面） | 返回根页面，清空查询 |
| 输入为空时按 `Backspace`（子页面） | 返回根页面，清空查询 |
| 点击浮层遮罩 | 关闭面板 |
| 执行命令且 `run` 未返回 `false` | 先关闭面板，再执行 |
| 窗口失焦 / 切到后台 | **不关闭**。面板是瞬时交互，用户切回时应该还在原处。 |

关闭时必须：复位 `page` 与 `query` → 把焦点还给打开前记录的元素（若该元素已从 DOM 卸载，回退到 `document.body`，不抛错）。

### 7.2 键盘

| 按键 | 根页面 | 子页面 |
| --- | --- | --- |
| `↑` / `↓` | 移动高亮项，**跳过禁用项**，到底循环（`loop`） | 同左 |
| `Home` / `End` | 跳到首/末可用项 | 同左 |
| `PageUp` / `PageDown` | 上/下翻 8 行 | 同左 |
| `↵` | 执行高亮项 | 同左 |
| `Esc` | 关闭 | 返回根页面 |
| `Backspace`（查询为空） | 无操作 | 返回根页面 |
| `Tab` / `⇧Tab` | 焦点保持在面板内（Base UI Dialog 的 focus trap） | 同左 |
| 其他可打印字符 | 输入到查询框 | 同左 |

**IME 组合期**：输入框 `onKeyDown` 必须检查 `event.nativeEvent.isComposing`。组合期间的 `↵` 属于"确认候选词"，绝不能执行命令。zh 是默认支持语言，这是必须验证的路径，不是边界情况。

**键位优先级（`Esc`）**，唯一权威顺序：

```text
1. 命令面板打开           → 面板处理（子页面返回 / 根页面关闭），stopPropagation
2. 命令面板关闭且有模态   → 由该模态（Base UI Dialog）处理
3. 命令面板关闭、无模态、处于设置页 → close_settings()
4. 其它                   → 业务页面自行处理
```

现有 `DesktopShell` 的 `Esc` 分支会把设置页一路关掉，与新的第 1 条冲突。必须在该分支前插入 `if (opened_palette_ref.current) return;`。由于监听器挂在 window 的 capture 阶段，面板的 `Esc` 会先到；面板处理后 `stopPropagation()`，shell 分支自然不再命中。两层保护都要有：捕获顺序是行为正确性，显式守卫是可读性。

### 7.3 鼠标

| 元素 | 行为 |
| --- | --- |
| 遮罩 | 点击关闭（仅当 `event.target === event.currentTarget`） |
| 命令行 | 单击执行；`onMouseMove` 时才把鼠标位置同步为高亮项（避免面板刚打开就被指针"抢走"键盘高亮） |
| 输入框前置返回按钮 | 仅在子页面出现，点击返回根页面 |
| 行内文本 | 不换行，`truncate`；完整内容通过 `title` 属性暴露 |
| 滚动条 | 使用全局 `::-webkit-scrollbar`（5px），不自定义 |

**不可点击但可见的禁用项**：保持 `cursor: default`，不触发 `onSelect`，鼠标悬停不改变背景（只有键盘高亮与已启用项的 hover 有背景）。

### 7.4 搜索与排序

纯函数：

```ts
export interface RankedCommand extends CommandDefinition {
  is_enabled: boolean;
}

export function filter_and_rank(
  commands: readonly CommandDefinition[],
  query: string,
  context: CommandContext,
): readonly RankedCommand[];
```

算法：

1. **可见性**：`when?.(context) === false` 的命令被移除。`enabled` 只影响 `is_enabled`，不移除。
2. **空查询**：保持注册顺序（注册时的稳定顺序由 `use_register_commands` 的调用顺序 + `filter_and_rank` 末级 tie-break 共同保证）。
3. **查询规范化**：`toLocaleLowerCase()` + 去除首尾空白 + 按连续空白切分为 token。CJK 不做分词，整段作为 token。
4. **匹配**：每个 token 必须在 `title`、`keywords`、分组标签三者拼接的 haystack 中找到匹配（**AND 语义**）。匹配方式按优先级：
   - `0` 标题完全相等
   - `1` 标题前缀匹配
   - `2` 标题子串匹配
   - `3` 关键词子串匹配
   - `4` 标题子序列匹配（允许跳字符，如 `noxw` → `打开 Workspace` 的拼音首字母之外的英文缩写）
   - 不匹配则整条命令被移除
5. **排序**：`score` 升序 → `command_group_order` 下标升序 → `order` 升序（缺省 0）→ `title` 的 `localeCompare` 升序。**末级必须存在**，否则同分组同 `order` 的命令在不同注册时机下顺序不稳定。
6. **截断**：结果多于 200 条时截断到 200，并在页脚提示 `command_palette.result_truncated`。
7. **稳定性**：给定相同输入必须返回相同输出，不做任何时间或随机依赖。这是 S3 与测试的前提。

`filter_and_rank` 不读取 store、不读 `document`、不构造被订阅的对象，因此可以在 Node 中直接测试。

### 7.5 执行语义

```text
用户按下 ↵
  → 若高亮项不存在或 is_enabled === false：不动作
  → 若命令 run 声明为子页面入口（在 pages 映射中）：切换 page，保持面板打开，查询清空
  → 否则：先关闭面板（含复位与焦点恢复），再调用 run(context)
  → run 返回 Promise：不阻塞 UI，不显示面板内 loading
  → run 抛错或 reject：调用 shell.report_error(error)，落到全局错误条
```

**不可逆操作规则（硬约束）**：面板只允许注册满足以下条件的命令：

- 可撤销（切换页面、切换设置值）；或
- 结果可被用户立即察觉且可逆（归档会话、停止执行）；或
- 会打开一个带有自身确认步骤的入口（新建 Workspace → 表单对话框）。

禁止注册：删除、退出登录、清空配置、不可撤销的状态迁移。`chat.archive` 允许，因为 Desktop 已有归档列表可恢复；`remove_session` 不允许。

### 7.6 子页面机制

```ts
const page_entries: Record<Exclude<CommandPage, "root">, string> = {
  workspaces: "goto.workspace",
  agents: "goto.agent",
  sessions: "goto.session",
  plugins: "nav.open-plugin-view",
};
```

- 命中该映射的命令 → 切页，面板不关闭。
- 页面栈深度固定为 2，**不实现多层栈**。P0 的页面之间没有互相进入的关系，引入栈是多余概念。
- 页面切换时清空查询、重置高亮到第一个可用项、把列表滚动位置归零。
- 子页面的占位文案、空状态文案、加载文案各不相同（见 11）。

### 7.7 状态清单

面板必须为以下每一个状态给出明确表现。`✓` 表示 P0 必须有实现与验收。

| # | 状态 | 表现 | 验收 |
| --- | --- | --- | --- |
| S1 | 关闭 | 不渲染任何 DOM（`open === false` 直接返回 `null`） | ✓ |
| S2 | 打开 / 空查询 / 根页面 | 按分组顺序展示全部可用命令，高亮第一项 | ✓ |
| S3 | 打开 / 有查询 / 有结果 | 只渲染匹配项；分组标题在组内无结果时不渲染 | ✓ |
| S4 | 打开 / 有查询 / 无结果 | 列表区域显示 `command_palette.empty`，保留输入框与页脚 | ✓ |
| S5 | 存在禁用项 | 置灰、不可选中、不可执行、行内展示 `disabled_reason` | ✓ |
| S6 | 子页面 / 数据未就绪（仅 `sessions`） | 单行加载态 `command_palette.empty.sessions_loading`，不显示"无结果" | ✓ |
| S7 | 子页面 / 数据为空 | 显示该页面的空状态文案 | ✓ |
| S8 | 子页面 / 有数据 | 行渲染 + 当前项 `TbCheck` + `aria-current` | ✓ |
| S9 | 行状态：默认 / 悬停 / 键盘高亮 / 选中 / 禁用 | 四态背景与文字规范见 8.3 | ✓ |
| S10 | IME 组合中 | `↵` 不执行命令；查询随组合结果更新 | ✓ |
| S11 | 命令执行失败 | 面板已关闭，全局错误条显示归一化错误 | ✓ |
| S12 | 应用数据在面板打开期间变化 | 注册表变化 → 列表更新；高亮项若消失则回落到最近的可用项，不抛错 | ✓ |
| S13 | 窗口失焦 | 面板保持打开 | ✓ |

---

## 八、视觉规范

### 8.1 尺寸与间距

| 元素 | 规格 | 说明 |
| --- | --- | --- |
| 遮罩层 | `fixed inset-0 z-50 bg-black/25` | 与现有占位实现一致；不再叠加 `backdrop-blur`（面板内容才是焦点，模糊会让长列表更耗性能） |
| 顶部偏移 | `pt-[15vh]`；窗口高度 < 480px 时 `pt-[8vh]` | 与 duobox 一致 |
| 面板容器 | `w-[min(34rem,calc(100vw-2rem))]`，`rounded-floating-surface`，`border border-border`，`bg-background`，`shadow-2xl` | 复用 `menu-styles.ts` 的 `rounded-floating-surface` |
| 输入行 | 高 `h-11`，`px-3`，下方 `border-b border-divider` | 输入字号 `text-sm` |
| 列表 | `max-h-[min(24rem,50vh)]`，`overflow-y-auto`，`p-1` | |
| 分组标签 | `menu_label_class_name`（`px-2 py-2 text-[11px] text-muted-foreground/60`） | 复用现有类名 |
| 命令行 | `min-h-8`，`px-2.5`，`gap-2.5`，`rounded-floating-item` | 复用 `menu_item_base_class_name` |
| 行图标 | 固定 `size-4`，`text-muted-foreground` | 通过 `[&>svg]:size-3.5` 之外的显式约束统一，避免不同图标库尺寸不一致 |
| 键位文本 | `menu_shortcut_class_name` | 复用 |
| 页脚 | 高 `h-8`，`border-t border-divider`，`px-3`，`text-[10px] text-muted-foreground` | |
| 面板与遮罩的点击 | 面板上 `onMouseDown` 阻止冒泡 | |

### 8.2 令牌与主题

- 只允许使用语义令牌：`bg-background`、`bg-popover`、`text-foreground`、`text-muted-foreground`、`border-border`、`border-divider`、`bg-interaction-hover`、`bg-interaction-selected`、`bg-interaction-active`、`text-destructive`、`ring-ring`。
- 禁止出现任何原始颜色值（`gray-500`、`#ffffff`、`rgba(...)`），否则 9 个主题里必然有主题失配。现有占位实现里的 `bg-black/25`、`bg-muted` 也一并替换为令牌写法。
- 行高亮态复用 `menu_item_highlighted_class_name`；行交互态复用 `menu_item_interaction_class_name`。这让面板与下拉菜单的选中观感天然一致。

### 8.3 行结构与状态

```text
[图标 16] [标题（truncate, flex-1）] [禁用原因 | 尾部装饰] [键位]
```

| 状态 | 背景 | 文字 | 光标 |
| --- | --- | --- | --- |
| 默认 | 透明 | 标题 `text-foreground/80` | `default` |
| 鼠标悬停（已启用） | `bg-interaction-hover` | 标题 `text-foreground` | `pointer` |
| 键盘高亮 | `bg-interaction-selected` | 标题 `text-foreground` | `default` |
| 当前项（Workspace/会话/Agent） | 同键盘高亮（若同时命中） | 标题 `text-foreground` + 尾部 `TbCheck` | — |
| 禁用 | 透明（不响应悬停） | 标题 `text-muted-foreground/60`，原因 `text-[10px] text-muted-foreground/50` | `default` |

`aria-selected="true"` 只跟随键盘高亮（与 listbox 语义一致），当前项身份用 `aria-current="true"` 表达，两者不混用。

### 8.4 文案规则

- 标题：动宾短语，≤ 14 个中文字符；不带句号。
- 副文案（子页面）：一句话，≤ 40 字符，超出截断。
- 禁止把命令名写成技术术语（`set_sidebar_mode` 这类 id 永远不出现在 UI 上）。id 只作为搜索关键词的一部分。

---

## 九、无障碍

### 9.1 语义结构

```html
<div role="dialog" aria-modal="true" aria-label="命令面板">
  <input
    role="combobox"
    aria-expanded="true"
    aria-controls="command-palette-listbox"
    aria-activedescendant="command-palette-option-<id>"
    aria-autocomplete="list"
    aria-label="搜索命令"
    autocomplete="off"
    spellcheck="false"
  />
  <ul id="command-palette-listbox" role="listbox" aria-label="命令">
    <li role="group" aria-labelledby="command-palette-group-navigation">
      <div id="command-palette-group-navigation">导航</div>
      <div role="option" id="command-palette-option-nav.open-chat" aria-selected="true">打开 Chat</div>
    </li>
  </ul>
  <div aria-live="polite" class="sr-only">共 12 条结果</div>
</div>
```

约束：

- 键盘高亮**不移动 DOM 焦点**，焦点始终在输入框；`aria-activedescendant` 指向当前项 id。这是 combobox 的标准做法，也让 IME 与输入法候选框行为正常。
- 高亮项变化时必须 `scrollIntoView({ block: "nearest" })`。
- 结果数量通过 `aria-live="polite"` 的视觉隐藏区域播报，粒度是"数量"而不是"每一条内容"，避免逐字击键造成刷屏。
- 禁用项使用 `aria-disabled="true"` 而不是原生 `disabled`，以保证它仍然出现在 `aria-activedescendant` 的候选集合里可被读出。

### 9.2 焦点

- 打开：`useLayoutEffect` 中聚焦输入框（`useLayoutEffect` 而非 `useEffect`，避免一帧的焦点空窗）。
- 关闭：恢复到打开前记录的元素；元素失效时依次回退到 `document.body`。
- `Tab` / `⇧Tab` 不逃出面板（依赖 Base UI Dialog 的 focus trap，不再自建 trap）。
- 面板内可聚焦元素只有：返回按钮（子页面）、输入框。列表项不参与 Tab 序列。

### 9.3 对比度

- 命令标题在 9 个主题下对 `background` 的对比度 ≥ 4.5:1（S9）。
- 页脚提示、分组标签属于次要信息，≥ 3:1；不使用 `text-muted-foreground/40` 以下的透明度。
- 禁用项的置灰不得低于 3:1，否则低视力用户会把禁用项误判为空行。
- 高亮态不依赖颜色单独传达：键盘高亮同时有背景色与（在行尾）无变化，因此仍需保证背景与背景之间有 ≥ 3:1 的明度差。

### 9.4 其他

- 鼠标目标高度 ≥ 32px（`min-h-8`）。
- 面板不使用动画入场，因此不需要 `prefers-reduced-motion` 分支；若后续加入动画，必须补该分支。
- 输入框 `spellcheck="false"` 与 `autocomplete="off"`，避免 Electron 拼写下划线干扰中文与命令名。

---

## 十、响应式与运行时约束

### 10.1 视口

- Desktop 是 Electron 桌面应用，**不提供移动端布局**。唯一需要保证的是窄窗口与矮窗口。
- 宽度：面板 `min(34rem, 100vw - 32px)`；窗口宽度 < 560px 时面板视觉上占满可用宽度（左侧栏在窄窗口下会折叠，面板仍是居中覆盖层，不参与布局计算）。
- 高度：列表 `max-h: min(24rem, 50vh)`；窗口高度 < 480px 时顶部偏移降为 8vh，并允许列表滚动。
- 缩放：`DesktopSettings.ui_scale`（0.85–1.2）会整体缩放字号与间距（`rem` 基准）。面板所有尺寸使用 `rem` 或 Tailwind 的 `h-11` / `min-h-8` 等相对值，不使用 px 固定值，保证 120% 缩放下不裁切。
- 多显示器与全屏：不做特殊处理。

### 10.2 性能

| 约束 | 要求 |
| --- | --- |
| 注册表快照 | 引用稳定，仅在变更时重建 |
| 面板订阅面 | 只订阅导航、catalog、session、settings 四个 store 的**明确切片**；不订阅 `chat_stream` |
| 过滤 | 300 条候选 / 10 字符查询 < 2ms（S3） |
| 渲染 | `sessions` 子页面 ≤ 200 行，不虚拟化；超限截断而非渲染 |
| 键盘输入 | 每次击键至多一次 `filter_and_rank` 调用；查询与页面状态不进入 store，不触发跨组件通知 |
| 关闭后 | 无订阅残留、无定时器、无全局监听器泄漏 |

### 10.3 主题与缩放

- 所有颜色走语义令牌（8.2）。
- `ui_scale` 变化时面板必须即时跟随（不复用缓存尺寸）。
- 主题切换（`color_theme`）在面板打开期间发生时应即时更新，不重新打开面板。

---

## 十一、国际化

### 11.1 命名空间与 key

全部文案放在 `common` 命名空间，前缀 `command_palette.`：

```text
command_palette.label                        命令面板
command_palette.search                       搜索命令
command_palette.placeholder                  搜索命令…
command_palette.placeholder.workspaces       搜索 Workspace…
command_palette.placeholder.agents           搜索 Agent…
command_palette.placeholder.sessions         搜索当前 Workspace 的会话…
command_palette.placeholder.plugins          搜索 Plugin…
command_palette.empty                        没有匹配的命令
command_palette.empty.workspaces             还没有 Workspace
command_palette.empty.agents                 还没有 Agent
command_palette.empty.sessions               当前 Workspace 还没有会话
command_palette.empty.sessions_loading       正在读取会话…
command_palette.empty.plugins                没有可用的 Plugin
command_palette.back                         返回
command_palette.hint.root                    ↑↓ 选择 · ↵ 执行 · Esc 关闭
command_palette.hint.page                    ↑↓ 选择 · ↵ 执行 · Esc 返回
command_palette.result_count                 共 {{count}} 条结果
command_palette.result_truncated             结果过多，仅显示前 200 条
command_palette.page.sessions_scope          当前 Workspace：{{name}}
command_palette.group.navigation             导航
command_palette.group.goto                   跳转
command_palette.group.create                 新建
command_palette.group.chat                   当前会话
command_palette.group.appearance             外观
command_palette.group.account                账户与模型
command_palette.cmd.nav.open-chat            打开 Chat
command_palette.cmd.nav.open-workspace       打开 Workspace
command_palette.cmd.nav.open-plugins         打开 Plugins
command_palette.cmd.nav.open-plugin-view     打开 Plugin…
command_palette.cmd.nav.toggle-sidebar-show  显示侧栏
command_palette.cmd.nav.toggle-sidebar-hide  隐藏侧栏
command_palette.cmd.nav.open-settings        打开设置
command_palette.cmd.nav.back-from-settings   返回上一个页面
command_palette.cmd.goto.workspace           切换 Workspace…
command_palette.cmd.goto.session             切换会话…
command_palette.cmd.goto.agent               打开 Agent…
command_palette.cmd.create.conversation      新建对话
command_palette.cmd.create.agent             新建 Agent
command_palette.cmd.create.group             新建 Group
command_palette.cmd.create.workspace         新建 Workspace
command_palette.cmd.chat.stop                停止当前执行
command_palette.cmd.chat.archive             归档当前会话
command_palette.cmd.chat.load-earlier        加载更早历史
command_palette.cmd.appearance.toggle-dark   切换到深色
command_palette.cmd.appearance.toggle-light  切换到浅色
command_palette.cmd.appearance.open          外观设置
command_palette.cmd.account.refresh-models   刷新模型目录
command_palette.cmd.account.open-models      模型设置
command_palette.cmd.account.open-user        账户与用量
command_palette.disabled.chat-stop           当前没有正在执行的 Turn
command_palette.disabled.chat-archive        当前不在会话中
command_palette.disabled.session-list        还没有选择 Workspace
```

### 11.2 迁移与约束

- 删除现有 `command_palette.open_settings` 与 `command_palette.toggle_sidebar`（占位实现移除后不再被引用；被 `command_palette.cmd.*` 取代）。
- `desktop_i18n.test.ts` 强制 en / zh key 完全一致且无空文案。新增 key 必须同时落两份文件，且不允许先留空字符串占位。
- 命令标题一律来自 i18n，不在 `CommandProviders` 里写中文字面量。`keywords` 允许写中英文别名（它们是检索数据，不是展示文案），但必须同时包含 zh 与 en 词，避免英文界面下搜不到。

---

## 十二、测试与验收

### 12.1 自动化测试

新增 3 个文件，遵循 `app/desktop/tests/*.test.ts` + `node --test` 约定。它们必须只依赖纯模块，不 import 任何 `.tsx`。

**`command_palette_registry.test.ts`**

1. 按注册顺序返回快照；注销只移除自己的条目。
2. id 冲突时（测试环境按 DEV 语义）抛错，且注册表内容不变。
3. 订阅者在注册/注销时收到通知，注销订阅后不再收到。
4. `register([])` 不触发通知。
5. 连续 注册 → 注销 → 再注册 同一 id 不抛错（StrictMode 序列）。
6. 快照引用在无变更时保持稳定（连续两次 `get_snapshot()` 全等）。

**`command_palette_filter.test.ts`**

7. 空查询保持注册顺序。
8. `when` 为 false 的命令被移除；`enabled` 为 false 的命令保留且 `is_enabled === false`。
9. 中文子串匹配（`会话` 命中 `切换会话…`）。
10. 英文关键词匹配（`session` 命中 `切换会话…`）。
11. 多 token AND 语义（`打开 设置` 命中，`打开 主题` 不命中）。
12. 同分时按 group → order → title 稳定排序，且两次调用输出一致。
13. 超过 200 条时截断到 200。
14. 空注册表 + 任意查询返回空数组，不抛错。

**`command_palette_shortcut.test.ts`**

15. `format_shortcut(["Mod","1"], "mac")` → `⌘1`；`"windows"` / `"linux"` → `Ctrl+1`。
16. `Esc` 在两个平台都显示 `Esc`。
17. `command_shortcuts` 展示映射快照：键位集合与 `DesktopShell` 现有分支一一对应，任何一侧单独改动都会让该测试失败。

### 12.2 手动验收清单（Electron 真机）

因 `node --test` 无 DOM，以下必须在真机逐条确认并记录结论：

1. 在 chat / workspace / plugins / plugin 工作区 / 会话页 / 设置页分别按 `⌘P`，面板打开且输入框有焦点。
2. 打开面板后按 `Esc` 只关面板；在设置页重复一次，确认设置页仍停留在原处。
3. 面板打开时按 `⌘⇧P`、`⌘⌥P` 不产生任何效果（验证 7.1 的守卫修正）。
4. 任一 Base UI 对话框（如新建 Workspace、模型详情）打开时按 `⌘P`，面板不出现。
5. 输入"会话" → `↵` 进入子页面 → `Backspace`（查询为空）返回根页面 → `Esc` 关闭。
6. 中文输入法（macOS 简体拼音）输入"huihua"，候选框可见时按 `↵` 只确认候选词，不执行命令；候选确认后按 `↵` 才执行。
7. `↑`/`↓` 长按遍历 `sessions` 子页面 200 行，高亮始终可见（`scrollIntoView` 生效），到底循环不卡顿。
8. 禁用项（如"停止当前执行"）在运行 Turn 时变为可用，Turn 结束后回到禁用并显示原因。
9. 会话正在流式输出时打开面板，输入流畅无掉帧（验证未订阅 `chat_stream`）。
10. 依次切换 9 个主题，确认面板标题、页脚、禁用项、高亮项均可读。
11. `ui_scale` 调到 0.85 与 1.2，确认面板不裁切、键位列不换行。
12. 窗口高度压到 420px，确认面板可用且列表可滚动。
13. 命令执行失败（例如断开网络后"刷新模型目录"）→ 面板关闭且全局错误条出现。
14. 打开面板 → 关闭 → 再打开，查询与页面均已复位。
15. 用 `Tab` / `⇧Tab` 尝试逃出面板，焦点始终留在面板内。

### 12.3 回归

- `pnpm -C app/desktop typecheck`（node + web 两份 tsconfig）。
- `pnpm -C app/desktop test` 全量通过，含既有 39 个测试文件。
- `pnpm -C app/desktop build`（macOS 生产构建）通过。
- 确认 `package.json` 依赖未变动（S10）。
- 确认 `Settings > Shortcuts` 页面文案未回退（⌘P 仍然被文档化）。

---

## 十三、风险与取舍

### 13.1 中文检索不能按拼音

用户输入 `huihua` 搜不到"会话"，输入首字母 `hh` 也搜不到。子串匹配对中文有效（输入"会话"可命中），但对拼音输入习惯不友好。

影响：中文用户的检索体验低于英文用户。

缓解：`keywords` 为每条命令补齐中文别名与英文别名；文档明确记录该限制。

后续：P2 引入带词典的拼音检索（只在关键词侧做映射，不改匹配主流程），代价是新增一个词典依赖，需要单独立项评估体积。

### 13.2 `command_shortcuts` 是第二份键位事实源

见 6.6。P0 无法避免，因为快捷键注册表超出本次范围。

影响：键位展示与实际绑定可能漂移。

缓解：不新增键位 + 快照测试 + 同 PR 成对修改的约定。

后续：P1 收敛为 `features/shortcuts/` 单一事实源，并删除这张表。

### 13.3 `sessions` 子页面只覆盖当前 Workspace

用户在不同 Workspace 之间找会话时必须先切 Workspace。

影响：跨 Workspace 的检索需要两次操作。

理由：跨 Workspace 聚合会把无上界的数据塞进一个瞬时面板，并且需要异步读取与取消逻辑，与"面板不做异步加载"的假设（A3）冲突。

后续：P1 增加"搜索全部 Workspace 的会话"，作为独立命令与独立页面，明确带加载态与取消。

### 13.4 `⌘P` 可能被未来占用

Electron 默认菜单在 macOS 上未占用 `⌘P`，当前安全。但如果后续引入打印、PDF 导出或文档搜索面板，`⌘P` 会被争用。

回退方案：整体切到 `⌘K`（Desktop 当前未占用），并同步修改 `DesktopShell`、`Settings > Shortcuts` 与 `command_shortcuts` 表。三处必须同 PR。

### 13.5 `Esc` 优先级是一次跨模块的隐式契约

面板的 `Esc` 依赖"window capture 阶段的监听器先于 Base UI Dialog 的内部处理"，同时对 `DesktopShell` 的 `Esc` 分支加了显式守卫。

影响：后续新增覆盖层（抽屉、Popover 中的可关闭区域）时，容易在这里引入回归。

缓解：7.2 的优先级表是唯一权威顺序，新增覆盖层必须更新该表；P1 应把"当前是否有更高优先级覆盖层"收敛为一个集中判断（`has_open_modal()` 的推广），而不是继续在 `DesktopShell` 里堆 if。

### 13.6 不引入 `cmdk` 意味着自建 listbox

需要自行保证：`aria-activedescendant` 正确、循环高亮跳过禁用项、`scrollIntoView`、Home/End/PageUp/PageDown、鼠标与键盘高亮不互相打架。

影响：实现工作量约 150–200 行，且 a11y 正确性依赖人工验收（12.2 第 7、15 条）。

替代方案：如果评审要求与 duobox 的观感与实现完全一致，可改用 `cmdk` + 复刻 `command.tsx`。代价是新增一个运行时依赖，违反 S10；且需要处理 cmdk 内置过滤与 `filter_and_rank` 并存的问题（必须设 `shouldFilter={false}`，否则出现两套过滤）。**若采纳该替代方案，必须同步修改 S10 的验收口径，而不是悄悄放行依赖。**

### 13.7 命令 id 冲突的生产降级

生产构建下重复 id 只记录错误并跳过，不抛错。这是为了让"注册错误"不至于白屏，但也意味着生产环境里一条命令可能静默消失。

缓解：开发期抛错覆盖绝大多数情况；`nav.*` / `goto.*` / `create.*` / `chat.*` / `appearance.*` / `account.*` 的命名空间约定写进 `types.ts` 的注释；`report_error` 不上报这类冲突（它属于开发期缺陷，不是用户可见故障），保持 `console.error`。

---

## 十四、实施顺序

每一步都可独立验证，避免把大改一次性合入。

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| 1 | `types.ts`、`registry.ts`、`filter.ts`、`shortcut_display.ts`（纯逻辑，无 UI） | `command_palette_registry.test.ts`、`command_palette_filter.test.ts`、`command_palette_shortcut.test.ts` 全绿 |
| 2 | i18n：新增 `command_palette.*` key（en + zh），删除两条旧 key | `desktop_i18n.test.ts` 全绿 |
| 3 | `types/DesktopView.ts` + `use_desktop.ts` 增加 `report_error` | typecheck |
| 4 | `components/ui/dialog.tsx` 增加 `data-desktop-modal="true"` 标记 | typecheck + 手动确认不影响现有 Dialog |
| 5 | `CommandPalette.tsx` + `CommandPageList.tsx`（先用 2 条硬编码数据自测渲染与键盘） | 手动验收 12.2 第 1、2、5、7、15 条 |
| 6 | `CommandProviders.tsx` 注册 6 组命令与 4 个子页面 | 手动验收 12.2 第 3–14 条 |
| 7 | `DesktopShell.tsx`：删除占位实现、挂载 Providers 与 Palette、修正 `⌘P` 守卫、插入 `Esc` 优先级、提炼 `create_conversation_in_context()` | 手动验收全量 |
| 8 | 收尾：主题对比度逐主题检查、`ui_scale` 检查、窄窗口检查、生产构建 | S9、12.3 |

步骤 1–3 不触碰任何现有组件，可以先行合入。步骤 5–7 必须在同一个 PR 内完成，因为占位实现与真实实现不能并存（否则 `⌘P` 会出现两个面板）。

---

## 十五、待决策与后续阶段

### 15.1 需要产品确认的问题

1. **`Esc` 在根页面是"关闭"还是"清空查询"？** 本 PRD 定为关闭（与 duobox 一致）。若希望 `Esc` 先清空查询、再关闭，需要调整 7.2，并重新定义"输入框非空时 `Esc`"的行为。二选一，不建议两种都做。
2. **`goto.agent` 的默认行为是"打开最近会话"还是"打开 Agent 配置页"？** 本 PRD 定为"打开最近会话"（复用 `open_agent_chat`），因为面板的加速目标通常是继续对话。如果需要 Agent 配置入口，应作为第二条命令显式列出，而不是让一条命令承担两种意图。
3. **`chat.archive` 是否算足够可逆？** 本 PRD 认为归档有独立列表可恢复，允许进入面板。若产品认为归档对用户而言等同删除，应从 P0 移除。

### 15.2 后续阶段（不在本次范围）

**P1：快捷键单一事实源**

- 新增 `features/shortcuts/`：键位目录（id、平台化 keys、scope、可发现性）、`format_shortcut` 的正式归属、`DesktopShell` 的监听器改为按目录派发。
- `Settings > Shortcuts` 与命令面板从同一份目录读取键位，删除 13.2 的第二份事实源。
- 收敛覆盖层优先级判断（13.5）。

**P1：Plugin 命令贡献点**

- 定义 Plugin 贡献协议（`plugin_id`、命令 id、标题、关键词、触发 action），宿主侧注册为 `plugin:<plugin_id>:<command_id>` 命名空间的命令。
- 需要先有插件贡献点基础设施（宿主侧的贡献注册 + Plugin Renderer 的读取 API）。本次不设计，避免在协议未定型时固化 API。

**P1：跨 Workspace 会话搜索**

- 独立命令 + 独立页面，带加载态、取消与结果上限。

**P2：拼音与首字母检索**

- 见 13.1，需要词典依赖的立项评估。

**P2：最近使用排序**

- 需要先有使用埋点或本地计数、过期策略与"确定性顺序被破坏后如何解释"的设计。在没有数据前不实现。

---

## 十六、实施记录

> 更新时间：2026-09-12。状态：P0 已实施，自动化验证通过；GUI 手动验收待产品确认。

### 16.1 已落地的文件

```text
app/desktop/src/renderer/features/command-palette/
  types.ts                命令类型 + 分组顺序 + 页面/文案 key 常量 + ShellCommandEnvironment
  registry.ts             CommandRegistry（严格模式冲突抛错 / 生产降级）+ command_registry 单体
  filter.ts               filter_and_rank / normalize_query
  shortcut_display.ts     detect_shortcut_platform / format_shortcut / command_shortcuts
  use_commands.ts         use_register_commands / use_commands
  CommandProviders.tsx    6 组内置命令（6 个 Hook）
  CommandPageList.tsx     4 个子页面的行投影 + use_command_page_items
  CommandPalette.tsx      面板外壳：浮层、输入、键盘、分组渲染、页脚
  index.ts                只导出 CommandProviders 与 CommandPalette

app/desktop/tests/
  command_palette_registry.test.ts   7 个用例
  command_palette_filter.test.ts     13 个用例
  command_palette_shortcut.test.ts   6 个用例
```

修改的既有文件：

| 文件 | 改动 |
| --- | --- |
| `app/DesktopShell.tsx` | 删除占位面板；挂载 `CommandProviders` 与 `CommandPalette`；修正 `⌘P` 的 Shift/Alt 守卫；面板打开期间接管键盘；把 `⌘R` 分支提炼为 `create_conversation_in_context()` 并与命令共用；新增 `has_open_modal()` |
| `types/DesktopView.ts` | `DesktopActions` 增加 `report_error(error: unknown): void` |
| `app/use_desktop.ts` | 实现 `report_error`（复用 `to_error_message` + `settings.set_error`） |
| `components/ui/dialog.tsx` | Dialog Popup 增加 `data-desktop-modal="true"` 标记 |
| `locales/{en,zh}/common.json` | 新增嵌套的 `command_palette.*` 文案树；删除 `command_palette.open_settings` / `command_palette.toggle_sidebar` |

### 16.2 实施中相对 PRD 的调整

1. **补上 `Esc` 的显式守卫。** 面板打开期间 `DesktopShell` 的监听器直接 `return`（`app/DesktopShell.tsx` 的 `if (command_palette_open)` 分支），而不是仅依赖 capture 阶段的到达顺序。这实现了 PRD §7.2 要求的“两层保护”，可读性也不再依赖隐式顺序。
2. **`⌘P` 在面板打开时再次按下会关闭面板。** PRD 未规定此行为；把它定义为 toggle 更符合用户预期，也避免了“面板开着时 ⌘P 无响应”的死角。
3. **子页面入口的判定提前到调用 `run` 之前。** PRD §7.5 原写“先关闭面板，再调用 run，run 返回 false 则留在面板内”，实现改为面板根据 `command_entry_pages` 直接拦截。理由：PRD 的写法会造成一次开→关→开的面板闪烁，而且需要从 `run` 的返回值反推界面控制流。`CommandDefinition.run` 仍保留返回 `boolean` 的类型能力（供后续扩展），但面板不再依赖它。
4. **`chat.stop` 的启用状态来自实时 store 切片。** 通过 `use_desktop_selector` 订阅当前 Session 的 runtime 切片（而不是整个 `chat_stream`），因此 Turn 结束后面板不需重开即可回到置灰态；`context.active_session` 只作为打开时的初始投影。
5. **`chat.load-earlier` 增加 `enabled` 条件。** 没有更早历史时置灰并显示原因，而不是让命令静默无效（这是 PRD §5.1 未覆盖的状态）。
6. **面板不复用 Base UI Dialog。** PRD §9.2 曾写“依赖 Base UI Dialog 的 focus trap”。实现改为自建容器并在 `Tab` 上显式在输入框与返回按钮间循环。理由：Dialog 会在 `Esc` 时无条件关闭，与“子页面 Esc 返回”直接冲突，组合两者会产生脆弱的顺序依赖；面板只有 1–2 个可聚焦元素，自建成本更低。
7. **`use_command_page_items` 增加 `scope_label` 与 `status`。** `sessions` 页面的作用域提示与加载态需要区分“索引未水合”与“确实为空”。
8. **新增 `--scrim` 语义令牌。** PRD §8.2 禁止组件里出现原始颜色值，但主题里原本没有可用的遮罩令牌（`foreground` 类令牌会随明暗主题反转，做遮罩会在浅色主题下反向变亮）。因此在令牌层新增 `--scrim: rgb(0 0 0 / 0.25)`（`semantic-colors.css` + `tokens.css` 的 `--color-scrim`），组件使用 `bg-scrim`。
   - 保留值为 `0.25` 是为了与它替换的占位实现遮罩强度一致，不引入视觉回归。
   - `components/ui/dialog.tsx` 的 `bg-black/60` 属于同一类问题，但修改它会改变现有 Dialog 观感，超出本次范围，未一并改动。建议作为后续清理项。
9. **`chat.load-earlier` 依赖实时历史游标。** 与第 4 条同理，通过 `use_desktop_selector` 订阅当前 Session 的 `history_by_session` 切片。

### 16.3 验证结果

| 项 | 结果 |
| --- | --- |
| `tsc -p tsconfig.web.json --noEmit` | 通过 |
| `tsc -p tsconfig.node.json --noEmit` | 通过 |
| `node --test tests/*.test.ts` | 221/221 通过（含新增 26 个命令面板用例） |
| `desktop_i18n.test.ts` | 通过（en/zh key 一致、无空文案） |
| `package.json` 依赖 | 未新增（满足 S10） |
| `Settings > Shortcuts` | 文案未回退，`⌘ / Ctrl + P` 仍被文档化 |
| 生产构建（`electron-vite build`） | main / preload 产物生成成功；renderer 已完成 5381 个模块 transform，chunk 渲染阶段被沙箱内存上限 OOM Kill（详见 16.4） |
| 完整模块图解析 | `DesktopShell.tsx` → 命令面板 → 领域模块的无循环依赖打包验证通过（esbuild bundle + Vite transform 双向确认） |
| GUI 手动验收（PRD §12.2 的 15 条） | **待产品确认** |

### 16.4 未完成项与阻塞

1. **GUI 手动验收未执行。** 本仓库的 Electron 真机验收需要在桌面环境运行应用，当前会话不具备该条件。PRD §12.2 的 15 条（尤其第 6 条中文输入法组合期、第 7 条长列表滚动、第 13 条错误上报、第 15 条 `Tab` 焦点约束）必须在发布前由人工逐条确认。
2. **生产构建的 renderer chunk 渲染阶段被沙箱内存上限终止。** 工作区的 `node_modules` 按 darwin-arm64 安装，而沙箱是 linux-arm64。已在沙箱内补齐 `@rollup/rollup-linux-arm64-gnu` 与对应版本的 `@esbuild/linux-arm64` 平台二进制（包括构建实际使用的 esbuild 0.27.7 与 0.25.12）。补齐后：
   - `out/main/index.mjs`（170.86 kB）与 `out/preload/index.cjs`（8.66 kB）生成成功；
   - renderer 阶段输出 `✓ 5381 modules transformed`，**即包含本次新增的 8 个文件的整个模块图已成功解析并转译**；
   - 随后的 chunk 渲染（mermaid 等重依赖）触发容器 OOM kill。

   **这是环境内存限制，不是代码问题。** 在任何与依赖安装平台一致、且内存充足的环境中执行 `pnpm -C app/desktop build` 即可完成该项验证。为确保验证结论不依赖该环境，另做了低内存的双向确认：
   - `tsc -p tsconfig.web.json --noEmit`（含 `@/` 与 `@common/` 路径别名）通过；
   - 以 esbuild 从 `DesktopShell.tsx` 入口做整图打包（含 `@/app/use_desktop`、`@/features/chat/lib/chat_cache_key`、`@/features/navigation/lib/sidebar_shortcut`、`@/features/plugin/lib/PluginIcon`、`@/locales/*` 等传递依赖），无解析错误、无循环依赖告警。
3. **`settings.json` 的 `shortcuts.*` 文案未扩充。** 面板新增的命令（如“切换 Workspace…”）未进入 `Settings > Shortcuts` 的静态清单。该清单位于 `SettingsView.tsx`，仍是手写字符串；把它改为从命令注册表生成是 P1 收敛快捷键单一事实源（§15.2）的一部分。当前状态下 `Settings > Shortcuts` 与面板之间不存在事实冲突（前者只列出全局键位，后者展示同一批键位），但这条边界需要在 P1 一并处理。

### 16.5 下一步建议

1. 在 darwin 环境执行 `pnpm -C app/desktop build` 与真机验收（§12.2）。
2. 验收通过后按 §15.2 启动 P1：建立 `features/shortcuts/` 单一键位事实源，删除 `command_shortcuts` 映射表，并让 `Settings > Shortcuts` 从该目录读取。
3. P1 同时设计 Plugin 命令贡献协议（需要先有宿主侧贡献点基础设施）。

---

## 附录 A：参考实现的对应关系


| duobox | Desktop（本 PRD） | 变化 |
| --- | --- | --- |
| `lib/command-palette/model.ts` | `features/command-palette/types.ts` | camelCase → snake_case；`closeOnRun` → `run` 返回值；新增 `disabled_reason`；`CommandContext` 改为只含投影数据 |
| `lib/command-palette/registry.ts` | `features/command-palette/registry.ts` | 增加"生产环境降级"行为；快照引用稳定性写入契约并测试 |
| `lib/command-palette/useCommands.ts` | `features/command-palette/use_commands.ts` | 排序职责移入 `filter_and_rank`，选择器只做投影与 `when` 过滤 |
| （无） | `features/command-palette/filter.ts` | 新增。duobox 依赖 cmdk 内置过滤；Desktop 需要确定性、可测试的排序 |
| `lib/shortcuts/types.ts` 的 `formatShortcutDisplay` | `features/command-palette/shortcut_display.ts` | 只取展示能力，不引入 scope / priority / 注册表 |
| `lib/command-palette/CommandProviders.tsx` | `features/command-palette/CommandProviders.tsx` | 分组由 space/environment/view 改为 navigation/goto/create/chat/appearance/account |
| `lib/command-palette/ExtensionCommandAdapter.tsx` | （未实现） | Desktop Plugin 没有 UI 贡献点；推迟到 P1 |
| `lib/command-palette/CommandPalette.tsx`（cmdk） | `features/command-palette/CommandPalette.tsx` + `CommandPageList.tsx` | 自建受控 listbox；复用 `menu-styles.ts` 的视觉类名 |
| `lib/palette/store.ts` | `CommandPalette` 内部 `useState` | 去掉 store，减少概念；状态只有单一消费者 |
| `lib/palette/DocSearchPalette.tsx` | （未实现） | Desktop 没有文档搜索面板；本次不引入并列面板 |
| duobox 的 `toast.error` | `shell.report_error(error)` → `DesktopErrorHost` | 复用现有全局错误条，不引入 toast 系统 |
