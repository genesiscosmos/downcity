# Desktop 状态管理与性能重构设计方案

> 状态：**已实施（领域 store、路由级订阅、持久消息索引、双 Chat 分段与渲染缓存生命周期完成）**
> 目标版本：`@downcity/desktop` 0.1.0（React 19.2.6）
> 关联代码：`app/desktop/src/renderer/`

## 一、背景与目标

重构前 Renderer 状态管理是 **单文件巨型 Hook** `use_desktop_controller.ts`（1895 行、41 个 `useState`），
覆盖 agents / workspaces / groups / sessions / messages / runtime / drafts / queue / plugins / settings / user / navigation 全部领域。
`App` 每次渲染都会重建整个 `controller` 对象并层层下传，任何一处状态更新都会导致整棵组件树重渲染。

本次重构目标：

1. **按 domain 拆分为多个独立 store**，每个 store 用稳定不可变快照配合 `useSyncExternalStore` 选择器订阅，实现状态变更的细粒度失效。
2. **热路径隔离**：消息流、runtime、mutation 的高频更新只触发 Chat 相关视图，不再波及 Sidebar / Settings / Plugin。
3. **拆分文件**：每个 domain store 独立文件并控制行数（<=1000 行）。
4. **消灭整表引用重建**：runtime / mutation 只更新受影响条目。
5. **组件 memo 化**：Sidebar 等静态组件不再随高频状态重渲染。

不改变任何外部行为与 IPC 协议，纯 Renderer 内部重构。

## 二、现状诊断

### 2.1 问题根因

| 编号 | 问题 | 位置 |
|---|---|---|
| P1 | 状态与消费没有隔离：整个 `controller` 作为 props 传递，无选择器 | `App.tsx` `use_desktop_controller()` |
| P2 | 热路径整表引用重建：runtime 每次事件重建整个 map | `on_runtime` |
| P3 | `agents` 变化全量拉取所有 Session | `useEffect([agents])` |
| P4 | `AgentSubject.running` 每次渲染遍历全部 workspace × session | `ChatSidebar.tsx` |
| P5 | `ChatSidebar` session 列表每次渲染全量 `flatMap().sort()` | `ChatSidebar.tsx` |
| P6 | 组件未 memo，父级一更新整体重渲染 | NavigationSidebar / AgentSubject / GroupSubject 等 |

### 2.2 已做对的部分（保留）

- mutation 使用 `requestAnimationFrame` 批处理
- 删除/归档 Session 的迟到事件屏蔽（`deleted_session_keys_ref`）
- 队列发送 `processing_queue_ref` 单循环
- 快照与 mutation 的 merge 逻辑
- 导航恢复、hydration 去重

## 三、目标架构

### 3.1 Store 拆分

将原有根状态拆为 **7 个独立 domain store**，每个 store 对外暴露：
- `subscribe(listener)` — 订阅整个 store 快照
- `get_snapshot()` — 返回不可变快照
- 若干 **action**（修改内部状态并触发通知）

| Store | 持有状态 | 高频更新源 |
|---|---|---|
| `use_navigation_store` | selection, sidebar_mode, active_workspace_id, plugin_routes, plugin_revisions | 导航切换 |
| `use_catalog_store` | agents, workspaces, groups, plugins, models, models_loading | 低频（列表刷新） |
| `use_session_store` | sessions_by_workspace, archived_sessions_by_workspace, group_sessions_by_workspace | 中频（Session 增删改） |
| `use_chat_stream_store` | messages_by_session, chat_runtime_by_session, file_diff_by_session, configuration_by_session, history_by_session + **group_message_projection_by_group（含分段已读状态）, group_member_statuses_by_group, group_phase_by_group, group_interactions_by_group** | **高频（runtime / mutation / 群聊流式）** |
| `use_composer_store` | draft_content_by_session, queued_messages_by_session, queue_paused_by_session | 中频（输入、队列） |
| `use_settings_store` | settings, global_env, user, accounts, account_resources, error, loading | 低频 |
| `use_notification_store` | notification_state | 通知变更 |

Group 的 message / member_status / phase / interactions 归入 `use_chat_stream_store`（群聊也是流式高频）；read_ids 由消息投影持有，已读事件只替换命中的分段，先于消息到达时暂存到投影等待收口。

### 3.2 核心机制：useSyncExternalStore + 选择器

React 19 的 `useSyncExternalStore` 支持 `getServerSnapshot` 与自定义 `getSnapshot`。
关键点：**每个 store 用独立的 immutable 快照对象**，`useSyncExternalStore` 只有在快照引用变化时
才会触发重新渲染。通过**细粒度的选择器**（返回具体字段），组件只在自己关注的数据变化时重渲染。

```ts
// 通用选择器 Hook
export function use_store_selector<State, Slice>(
  store: Store<State>,
  selector: (state: State) => Slice,
): Slice {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get_snapshot()),
    () => selector(store.get_snapshot()),
  );
}
```

由于每个 store 独立，`chat_stream` 的 runtime 更新不会通知 `catalog` / `navigation` 的订阅者。

### 3.2.1 选择器的稳定性约束（关键）

`useSyncExternalStore` 的失效判定是 `Object.is(上一次选择结果, 本次选择结果)`。
因此**选择器必须返回稳定引用**，否则每次渲染都会拿到新对象，造成无限重渲染。

两条硬性规则：

1. **选择具体键，不选整个 map**。
   例如 `(state) => state.chat_runtime_by_session[session_key]`，而不是整个 `chat_runtime_by_session`。
   前者只有该 Session 的 runtime 变化时才产生新引用；后者每次任意 Session 的 runtime 事件都会变化。
2. **派生结果必须 memo 化**。
   需要组合多个字段（如 Sidebar 的排序列表）时，把选择器拆成"选原始数组"，再用 `useMemo` 在组件内缓存派生结果。
   禁止在选择器内 `sort / filter / find / flatMap` 返回新数组。

```ts
// ✅ 正确：按 session_key 选择单个运行态（引用稳定，只有该 Session 变化才重渲染）
const runtime = use_store_selector(chat_stream_store, (s) => s.chat_runtime_by_session[key]);

// ✅ 正确：选择原始数组，在组件内用 useMemo 派生排序列表
const selected_sessions = use_store_selector(
  session_store,
  (s) => s.sessions_by_workspace[workspace_id],
);
const sessions = selected_sessions ?? empty_workspace_sessions;
const sorted = useMemo(() => sort_sessions(sessions), [sessions]);

// ❌ 错误：选择器内构造新数组，每次渲染都触发重渲染
const sorted = use_store_selector(chat_stream_store, (s) => Object.entries(s.sessions_by_workspace).sort());
```

组件层配合：高频订阅点（消息列表、runtime、输入草稿）都用**最小切片**订阅，
并配合 `React.memo` 让兄弟节点在切片未变时不重渲染。

### 3.2.2 跨 store 依赖的编排

`send_message` 等 action 同时依赖 queue、runtime、draft、sessions 等多个 store。
组合层（`use_desktop_controller`）持有各 store 的 `get_snapshot()` 与 action，
在 action 内部通过**同步读取最新快照**（store 内部维护 ref 镜像）协调，
保持现有语义（队列单循环、孤儿 Session 补发、stop/steer）完全不变。

### 3.2.3 组件消费模式迁移（关键）

现状：`App` 拿到整个 `controller` 对象，层层下传；组件内 `controller.xxx` 直接取字段。
只要 controller 引用变化，所有下游 props 都变，`React.memo` 也拦不住。

因此**必须改变消费方式**：组件不再接收/订阅整个 controller，而是通过 selector 订阅自己需要的**最小切片**。

```ts
// 现状（不能用于拆分后）：任何 store 变化都重建 controller，所有组件重渲染
const controller = use_desktop_controller();
const agents = controller.agents;

// 目标：按字段订阅，只在自己的切片变化时重渲染
const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
const sessions = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace[workspace_id]);
const runtime = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session[key]);
const running = use_desktop_selector(controller.stores.chat_stream, (state) => state.executing_agent_ids.has(agent_id));
```

配套规则：

1. **高频字段用布尔/单值选择器**。`AgentSubject` 的"正在回复"用 `executing_agent_ids.has(agent_id)`
   返回布尔值——只有该 Agent 运行态翻转时才变化，消息流/runtime 的其它更新不会触发它重渲染。
2. **列表字段只选原始数组，派生在组件内 `useMemo` 缓存**（同 3.2.1）。
3. **回调一律稳定**（store action 全部 `useCallback`），避免子组件 props 每次变。

迁移时每个组件改动量小（把 `controller.xxx` 换成对应 selector 或切片 props），
但收益是决定性的：Sidebar / Navigation / Settings 全部从高频更新中脱离。

### 3.3 Store 实现

每个 store 用 `useRef` 持有唯一不可变快照，`commit` 同步替换快照并通知订阅者，
不触发创建 store 的根组件重渲染。所有 action 通过 `useCallback` 稳定引用，store API
再通过 `useMemo` 固定，最终组合为稳定 controller。

```ts
// 示例：chat_stream store（简化）
export function use_chat_stream_store() {
  const state_ref = useRef(initial_state);
  const listeners_ref = useRef(new Set<() => void>());
  const commit = useCallback((next_state) => {
    state_ref.current = next_state;
    for (const listener of listeners_ref.current) listener();
  }, []);
  const store = useMemo(() => ({
    subscribe(listener) {
      listeners_ref.current.add(listener);
      return () => listeners_ref.current.delete(listener);
    },
    get_snapshot: () => state_ref.current,
  }), []);
  return store;
}
```

### 3.4 热路径优化

1. **runtime 更新只改受影响条目**：不再重建整个 `sessions_by_workspace` map；
   `executing_agent_ids` 直接基于 canonical runtime 的 `agent_id` 聚合，不解析 Session 组合键。
   同一 Agent 的一个 Session 结束时，只要仍有其它运行中 Session 就保留执行标记；Sidebar 使用 `Set.has()` 判断。
2. **mutation 批处理保留**：rAF 批处理继续，但只更新 `chat_stream_store` 内的 `messages_by_session`。
   每个 Session 持有与消息数组引用绑定的 `message_id -> index`，已有消息的流式更新不再逐帧全量建表和排序；
   新消息才按 `sequence` 二分插入并重建位置索引。
3. **Session 列表派生缓存**：`ChatSidebar` 用 `useMemo` 缓存 agent_sessions 排序结果，
   依赖 `[agents, sessions_by_workspace]`（或对应 selector），避免每次渲染全量计算。

### 3.5 组件 memo 化

- `NavigationSidebar` / `ChatSidebar` / `WorkspaceSidebar` / `PluginSidebar` / `PluginWorkspaceSidebar` / `SettingsSidebar`
- `AgentSubject` / `GroupSubject` / `SessionListItem` / `SessionListRow`
- 统一用 `React.memo` 包裹，props 收紧为「选择器切片 + 稳定回调」。

## 四、文件结构

```
app/desktop/src/renderer/
  hooks/
    use_desktop_controller.ts      # 组合 7 个 store 与稳定 actions（瘦身）
    store/
      store_types.ts               # Store 通用类型 + use_store_selector
      use_navigation_store.ts      # 导航
      use_catalog_store.ts         # agents/workspaces/groups/plugins/models
      use_session_store.ts         # sessions/group_sessions/archived
      use_chat_stream_store.ts     # messages/runtime/file_diff/configuration/history + group 流式
      use_composer_store.ts        # drafts/queue/queue_paused
      use_settings_store.ts        # settings/global_env/user/accounts/resources/error/loading
      use_notification_store.ts    # notification_state 与主进程订阅生命周期
  lib/group/
    group_session_projection.ts    # 保留，改为接收拆分的 state 切片
```

## 五、迁移步骤

1. **新建 store 目录与通用机制**（`store_types.ts`、`use_store_selector`）。
2. **逐 store 抽取**：先从 `use_chat_stream_store` 开始（最高频），再到 catalog / navigation / settings。
3. **重写 `use_desktop_controller.ts`**：只做组合，不再持有原始 state；
   内部跨 store 的副作用（如 send_message 需要 queue + runtime）通过 store action 的 ref 互相调用。
4. **组件改造**：`App.tsx` 的 view props 改为从 selector 取值；
   Sidebar 组件改为接收切片 props 并用 `React.memo`。
5. **验证**：`pnpm --filter @downcity/desktop typecheck` + `pnpm --filter @downcity/desktop test`。

## 六、风险与注意事项

- **跨 store 副作用**：`send_message` 涉及 queue + runtime + draft + sessions，需在组合层编排，
  保持现有语义（队列单循环、孤儿 Session 补发、stop/steer 逻辑）完全不变。
- **snapshot 引用**：每个 store 的 snapshot 必须不可变，避免意外重渲染或订阅丢失。
- **Group 流式**：group message / status / phase / read_ids / interactions 归入 chat_stream，
  与 Agent Session 同等对待，不改变群聊行为。
- **性能收益**：长会话 + 多 Agent + 多 Workspace 场景下，runtime 高频更新将只影响
  当前 Chat 视图的 selector 切片，Sidebar 与导航树不再重渲染。

## 八、前端项目框架逻辑（现状 → 目标）

### 8.1 技术栈与分层

| 层 | 说明 | 目录 |
|---|---|---|
| 入口 | `main.tsx` 挂载 `<App />`，注入全局 React runtime 供 Plugin Renderer 共享 | `src/renderer/main.tsx` |
| 应用壳 | `App` 持有根状态，按 `selection` 路由到各 MainView，并负责全局快捷键/链接拦截 | `src/renderer/App.tsx` |
| 布局 | Sidebar 容器（Navigation / Settings）+ MainView 壳（Header / BayBar / Shell） | `src/renderer/layouts/` |
| 视图 | 各业务页面（Session / Agent / Group / Workspace / Plugin / Settings / Welcome） | `src/renderer/views/` |
| 组件 | 跨页面复用（Dialog / Dropdown / Switch / 头像 / 用量图） | `src/renderer/components/` |
| 状态 | `use_desktop_controller` 单 Hook（本次重构核心） | `src/renderer/hooks/` |
| 逻辑库 | 纯函数（session_mutation / navigation / notification / group 投影 / composer 编解码） | `src/renderer/lib/` |
| IPC 桥 | preload 暴露的 `window.downcity.*`（agent / chat / group / workspace / settings / plugin / user / notification） | `src/preload/index.ts` + `src/common/types/DesktopApi.ts` |

### 8.2 数据流（现状）

```
主进程 IPC 事件（on_mutation / on_runtime / group.subscribe / notification.subscribe）
        ↓
use_desktop_controller（41 个 useState 的单一 Hook）
        ↓ 每次任一 state 变化重建整个 controller 对象
App（render_main_view 依赖 controller）
        ↓ 整个 controller 作为 props 下传
NavigationSidebar / ChatSidebar / SessionView / AgentView / ...（无 memo，全量重渲染）
```

问题：**没有失效边界**。一条 runtime 事件会刷新 Sidebar、Navigation、Settings 等与本次回复无关的整片子树。

### 8.3 数据流（目标）

```
IPC 事件按 domain 分流到 7 个独立 store
  ├─ use_navigation_store   （selection / sidebar_mode / active_workspace_id / plugin routes）
  ├─ use_catalog_store      （agents / workspaces / groups / plugins / models）
  ├─ use_session_store      （sessions / group_sessions / archived 索引）
  ├─ use_chat_stream_store  （messages / runtime / file_diff / config / history / group 流式）◀─ 高频热路径
  ├─ use_composer_store     （drafts / queue / queue_paused）
  ├─ use_settings_store     （settings / global_env / user / accounts / error / loading）
  └─ use_notification_store （通知快照与订阅生命周期）
        ↓ 各 store 独立 immutable 快照 + useSyncExternalStore
组件按最小切片订阅（use_store_selector）或接收稳定 actions
  ├─ Chat 视图：只订阅 messages / runtime / draft / queue（高频）
  └─ Sidebar / Navigation / Settings：只订阅自己的切片（低频）→ React.memo 生效
```

关键：**高频更新只进入 `use_chat_stream_store`**，其余 store 的订阅者完全不受影响。

### 8.4 对外 API（组合层）

`use_desktop_controller()` 不再返回一个会随状态重建的扁平对象，而是返回**两类稳定对象**：

```ts
interface DesktopController {
  /** 全部 action，useCallback 稳定引用，不随状态变化；跨 store 逻辑在此编排。 */
  actions: DesktopActions;
  /** 7 个 store 句柄（subscribe / get_snapshot），稳定。 */
  stores: DesktopStores;
}

// 组件统一用 selector 订阅最小切片（内部路由到对应 store）：
const messages = use_desktop_selector(controller.stores.chat_stream, (state) => state.messages_by_session[key]);
const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
const running = use_desktop_selector(controller.stores.chat_stream, (state) => state.executing_agent_ids.has(agent_id));
```

只做操作、几乎不读状态的页面（Agent 配置 / Group 配置 / Workspace 配置 / Plugin 页）接收 `actions` 对象，
引用稳定 → `React.memo` 直接生效；需要状态的页面用 `use_desktop_selector` 订阅最小切片。

## 九、全量改动清单（按文件）

### 9.1 新增文件（7）

| 文件 | 内容 |
|---|---|
| `hooks/store/store_types.ts` | `Store<State>` 接口（subscribe/get_snapshot）、`use_store_selector` 通用 hook、公共工具（`without_key` / `move_draft_value` / `to_error_message` / `normalize_global_env_text`，从原 controller 抽出） |
| `hooks/store/use_navigation_store.ts` | selection / sidebar_mode / active_workspace_id / plugin_routes / plugin_revisions + 全部导航 action；迁移 selection 记忆、localStorage 持久化、notification view state 上报 |
| `hooks/store/use_catalog_store.ts` | agents / workspaces / groups / groups_by_id / plugins / models / models_loading + 对应 CRUD action（不含跨 store 副作用，见 9.2） |
| `hooks/store/use_session_store.ts` | sessions_by_workspace / archived_sessions_by_workspace / group_sessions_by_workspace + 索引更新 action；迁移 `index/merge/replace/remove_group_sessions` |
| `hooks/store/use_chat_stream_store.ts` | messages / runtime / file_diff / configuration / history / **executing_agent_ids** / Group 持久消息分段与流式字段 + 对应 setter；迁移 mutation rAF 批处理、runtime 订阅、group.subscribe |
| `hooks/store/use_composer_store.ts` | drafts / queued_messages / queue_paused + 草稿与队列 action；迁移 queue_ref / process_next_queue（busy 判断由组合层注入） |
| `hooks/store/use_settings_store.ts` | settings / global_env / user / accounts / account_resources / error / loading + 设置/登录 action；迁移外观副作用 |

### 9.2 重写（1）

| 文件 | 改动 |
|---|---|
| `hooks/use_desktop_controller.ts` | 从 1895 行瘦身为 937 行组合层：调用 7 个 store，组装稳定 `actions` 与 `stores`；管理、Group、导航 action 分别拆入 `hooks/controller/`；保留 hydration 去重、迟到事件屏蔽、队列单循环语义 |

### 9.3 改造（12）

| 文件 | 改动 |
|---|---|
| `types/DesktopView.ts` | 删除 `DesktopViewController` 扁平兼容层，保留 `DesktopController`（`stores` + `actions`），并统一定义各领域 store state 类型 |
| `App.tsx` | 改用 `actions` + `use_desktop_selector`；Session / Group 高频 selector 下沉到对应 Chat Surface，根壳只订阅导航目标；`DesktopMainView` 只做路由分派，各路由组件仅订阅当前业务对象；全局 keydown/link 监听依赖稳定 actions |
| `layouts/NavigationSidebar.tsx` | `React.memo`；组件内部订阅 selection / sidebar_mode / notification_state / user / plugins，仅接收稳定 actions 与本地 UI props |
| `layouts/SettingsSidebar.tsx` | `React.memo`；props 收紧为 selection + open_settings / close_settings |
| `layouts/sidebar/ChatSidebar.tsx` | `React.memo`；`agent_sessions` 排序用 `useMemo`；`AgentSubject.running` 改用 `executing_agent_ids.has(agent_id)`；AgentSubject / GroupSubject 各自 memo |
| `layouts/sidebar/SessionListItem.tsx` | `SessionListItem` / `SessionListRow` 用 `React.memo` |
| `layouts/sidebar/WorkspaceSidebar.tsx` | `React.memo`；props 收紧为 workspaces / selection / loading + 稳定 actions |
| `layouts/sidebar/PluginSidebar.tsx` | `React.memo`；props 收紧为 plugins / selection + select_plugin |
| `layouts/sidebar/PluginWorkspaceSidebar.tsx` | `React.memo`；props 收紧为 plugins / plugin_routes / plugin_revisions / notification + 稳定 actions |
| `views/SessionView.tsx` | canonical 消息按固定 sequence 区间投影为稳定 Segment；`MessageSegment` 与 `MessageRenderer` 分层 memo，流式更新不再协调或解析历史 Markdown；输入编辑器独立 memo |
| `views/AgentView.tsx`、`GroupView.tsx`、`WorkspaceView.tsx`、`PluginView.tsx`、`PluginWorkspaceView.tsx`、`SettingsView.tsx` | 改为接收稳定 `DesktopController` 或 `DesktopActions`；Group 消息、交互和输入提示行使用 memo，Agent 与已读状态分别使用 `Map` / `Set` 索引 |
| `lib/group/group_session_projection.ts` | 类型从旧 controller 索引改为独立的 `Record<string, DesktopWorkspaceGroupSession[]>` |

### 9.4 可删除（1，疑似死代码）

| 文件 | 依据 |
|---|---|
| `layouts/sidebar/AgentSidebar.tsx` | 全 renderer 无任何 import（grep 仅命中自身）；`NavigationSidebar` 实际使用 `ChatSidebar`。重构后确认无引用即删除 |

### 9.5 热路径纯函数

`lib/chat/session_mutation.ts` 新增持久索引批量投影：`use_chat_stream_store` 跨 rAF 批次复用消息位置索引，
每个被修改的 Assistant 只复制一次 parts，并在批次末尾生成一次不可变消息数组。索引随 snapshot、LRU 淘汰、
Session 删除与 Workspace 清理同步重建或释放。`lib/group/group_message_projection.ts` 直接持有固定 32 条消息分段，
单条追加只复制末尾分段，不复制完整历史消息数组。

### 9.6 改动顺序（建议）

1. `store_types.ts` + `use_chat_stream_store.ts`（最高频，先立基）→ typecheck
2. 其余 5 个 store → typecheck
3. 重写组合层 `use_desktop_controller.ts`，过渡期保留旧扁平接口 → typecheck
4. 改 `DesktopView.ts` 类型 + `App.tsx` 消费方式 → typecheck
5. 逐个改造 Sidebar / View 组件（每批 typecheck）
6. 删除 `AgentSidebar.tsx`，全量 typecheck + test

## 十、验收标准（补）

- [x] `use_desktop_controller.ts` 组合层 + 7 个 store 均 <=1000 行
- [x] 页面仅依赖稳定 `actions` / `stores`，不存在扁平状态 controller
- [x] 高频字段（runtime / messages / draft）按当前 Chat 键在 Chat Surface 内订阅，不触发 App 根壳更新
- [x] 历史消息按固定 sequence 分段和 canonical 对象引用跳过协调，Action 归属为 O(n) 投影
- [x] 同一动画帧的 Session mutation 批量合并后只发布一次最终快照
- [x] Group status 原子写入成员状态与阶段，相同事件不重复发布快照
- [x] 常用 store setter 对相同标量、对象引用和领域值短路
- [x] 同一 Agent 多个 Session 并行执行时，任一 Session 结束不会误清除 Agent 运行标记
- [x] Workspace 清理在没有缓存命中时不发布 chat / composer / session 快照
- [x] App 根壳只订阅导航目标，通知、业务状态与弹窗状态在独立消费边界失效
- [x] `DesktopMainView` 不订阅领域数据，Group 高频更新不会使 Agent / Workspace / Plugin 主视图失效
- [x] Session mutation 跨动画帧复用持久位置索引，只有结构变化才重建索引
- [x] Group 消息在 store 中按 32 条持久分段，追加只替换尾部分段
- [x] GroupSession 快速切换时，过期异步请求不能回写活动会话、消息或导航
- [x] `AgentSidebar.tsx` 确认无引用后删除，`NavigationSidebar` 无死 import
- [x] Web/Node typecheck、Desktop 全量测试与生产构建通过

## 十一、长会话视口渲染与滚动所有权

### 11.1 产品意图与实现边界

长会话优化的目标是在不破坏消息查找、文本选择、流式输出和历史前插位置的前提下，减少离屏 Markdown 的布局与绘制成本。
Session 消息由 canonical 消息数组持有；Group 消息由 store 内的持久分段持有。视口层只消费对应投影，
不复制消息，也不成为第二事实源。

当前阶段不引入完整虚拟列表。消息包含 Markdown、代码块、公式和图表，真实高度会在渲染后变化；直接卸载离屏 DOM
会额外引入高度测量、选区恢复和滚动锚点生命周期。Renderer 先使用 Chromium 原生 `content-visibility: auto`：

- 完整 DOM、浏览器查找和文本选择语义保持不变。
- 离屏静态消息跳过布局与绘制，并用浏览器记录的真实高度更新固有尺寸。
- 正在流式变化的 Assistant 消息不进入隔离边界。
- 若实际长会话分析仍显示 DOM 节点数量是主要瓶颈，再单独设计动态高度虚拟列表。

React 协调层按 canonical `sequence` 的固定 32 区间建立稳定 Segment：

- 追加消息只改变尾部 Segment，历史前插不会重新划分已有 Segment。
- 每次投影复用消息和 Action 成员均未变化的 Segment 引用。
- `MessageSegment` 通过 `React.memo` 阻断未变化分段的消息元素创建与 reconciliation。
- 投影扫描同时汇总流式状态和可压缩消息状态，不再额外遍历完整消息数组。

### 11.2 滚动所有权

`use_chat_scroll` 是 Session 与 Group 消息面板唯一的滚动策略所有者：

1. 用户距离底部小于 80px 时视为 sticky；只有 sticky 且开启自动滚动时才跟随内容增长。
2. `ResizeObserver` 观察消息内容真实高度，覆盖 Markdown、公式和图表完成渲染后的异步增高。
3. 加载更早历史前先记录首个可见消息 ID 与视口偏移，提交后按同一消息恢复位置；只有消息不存在时才退回高度差补偿。
4. Session 切换会取消上一 Session 未完成的动画帧和历史锚点，避免跨 Session 写入滚动位置。
5. Group 与 Session 共用同一策略，Group 成员状态变化不再无条件抢回底部。

### 11.3 验收标准

- [x] Session 与 Group 的静态消息行具备原生离屏渲染隔离
- [x] 流式 Assistant 消息保持实时布局与绘制
- [x] Session 历史前插按稳定消息 ID 保持视口位置
- [x] 动态高度内容在 sticky 状态下持续跟随底部
- [x] Group 尊重用户手动离开底部的滚动状态
- [x] 滚动判定与锚点补偿具有独立纯函数测试
- [x] 五千条消息尾部更新只替换尾部分段，其余历史分段引用全部复用

## 十三、路由订阅与 Group 请求生命周期

### 13.1 路由级失效边界

`DesktopMainView` 只依据导航目标选择路由组件，本身不订阅 Catalog、Session 或 Settings。每种路由在独立组件内
选择自己的最小数据集，例如 Agent Session 不订阅 Group 与 Plugin，Group 配置只订阅当前 `groups_by_id[group_id]`。
因此 Group 的消息计数与 Session 摘要变化不会再使正在显示的 Agent Chat 被动重渲染。

### 13.2 GroupSession 请求所有权

Group 导航编排持有单调递增的请求版本。一次打开操作先读取 Session 列表、Group 快照和消息快照，确认仍是最新请求后，
再提交 Catalog、Session 索引、活动 Session、消息分段与导航。后发的 Group Session 或 Draft 导航会立即使旧请求失效；
旧请求的响应和错误都不会覆盖当前页面。请求同时记录发起时的导航快照，因此用户转去 Agent、Workspace 或 Plugin 等
任意其它页面后，即使没有发起新的 Group 请求，原 Group 响应也不能把页面拉回。

### 13.3 验收标准

- [x] 快速切换两个 GroupSession 时只允许最后一个请求提交
- [x] 切换到 Group Draft 会使尚未完成的 GroupSession 请求失效
- [x] 切换到任意非 Group 页面会使尚未完成的 GroupSession 请求失效
- [x] Group 消息追加不复制完整消息历史
- [x] 同一动画帧的多条 Group 消息只发布一次 store 快照
- [x] snapshot 与实时消息交叠时按 `message_id` 去重
- [x] Group 消息事件不再逐条改写低频 Catalog 摘要
- [x] 未变化的 Group 历史分段通过 `React.memo` 跳过元素创建与 reconciliation

## 十二、Session 渲染缓存生命周期

### 12.1 所有权与容量

Session canonical 消息仍由 Agent Session 持有；Renderer 只缓存可从 snapshot 重建的展示投影。
`use_chat_stream_store` 保留当前激活 Session、所有 snapshot 请求中的 Session，以及最近 8 个非激活 Session。

LRU 只淘汰以下可重建状态：

- `messages_by_session`
- `history_by_session`
- `file_diff_by_session`

实时运行态、模型配置、队列、草稿和 `executing_agent_ids` 不参与淘汰，避免缓存策略进入执行语义。

### 12.2 snapshot 与 mutation 竞态

打开或刷新 Session 时先登记 pending snapshot。该阶段允许接收实时 mutation，snapshot 返回后继续使用 revision
规则合并，避免旧快照覆盖新事件。只有成功合并完整 snapshot 的 Session 才标记为 hydrated：

- hydrated 或 pending Session 可以接收消息和文件改动事件。
- 已淘汰 Session 的后台 mutation 不创建残缺缓存。
- 全部并发 snapshot 均失败时，原子删除请求期间形成的残缺消息、历史和文件改动状态。
- 重新打开已淘汰 Session 时重新读取 canonical snapshot。
- 相同 Session 的并发聚焦刷新复用同一个 single-flight Promise，不重复请求消息与配置。
- 相同 revision 的快照优先复用 Renderer 现有消息对象；全部消息未变化时继续复用消息数组与位置索引。

### 12.3 缓存键

Agent Session 与 Group Chat 使用独立类型标签和长度前缀字段编码，不再使用裸 `:` 拼接。
因此任意业务标识包含分隔符或 Unicode 字符时都不会碰撞，同时可以安全生成 Workspace 清理前缀。

### 12.4 验收标准

- [x] 当前 Session 与 pending snapshot 不会被容量策略淘汰
- [x] 超出容量时按最近访问顺序淘汰最旧的非激活消息缓存
- [x] 淘汰消息、历史与文件改动时只发布一次 store 快照
- [x] 后台 runtime 与队列处理不依赖消息渲染缓存
- [x] 组合键分隔符、Unicode、Agent/Group 命名空间和 Workspace 清理均有纯函数测试
- [x] `focus` 与 `visibilitychange` 同时触发时不重复读取同一 Session
- [x] 未变化快照不使历史消息 Segment 与 Markdown 渲染缓存失效

## 十四、Chat 输入草稿同步

### 14.1 编辑所有权

Tiptap Editor 是输入过程中的实时状态所有者。键盘输入先只更新编辑器自身与输入框内的局部状态，不再逐键把完整 JSON
写入 composer store。用户停止输入 300ms 后，最新文档作为可恢复草稿同步一次；失焦、Session 切换或组件卸载前强制 flush。

每份待同步草稿同时保存生成时对应的 `update_draft`，即使切换 Session 发生在 effect cleanup 之前，也只会写回原 Session。
发送开始时丢弃等待中的计时器，由发送/失败恢复流程接管该份输入，防止迟到同步把已发送内容重新写回。

### 14.2 外部状态回写

编辑器记录最近一次主动发布的 JSON 引用。composer store 回传同一对象时直接确认，不再执行两次 `JSON.stringify` 或
`setContent`；发送成功清空、发送失败恢复、切换 Session 等真正的外部变化仍通过 `setContent` 明确应用。

### 14.3 验收标准

- [x] 普通连续输入不再逐键发布 composer store 快照
- [x] 发送按钮的空内容状态由编辑器局部更新，不依赖父级重渲染
- [x] 失焦、Session 切换和卸载前不会丢失等待同步的草稿
- [x] 发送后不会被迟到的草稿计时器恢复旧内容
- [x] 本地草稿回传不再序列化并重设完整 Tiptap 文档
