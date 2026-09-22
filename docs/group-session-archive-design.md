# GroupSession 归档能力设计

> 状态：**已实施**。能力落在 `packages/agent`（`GroupSessions.archive` / `archived` / `clean_archive` / `purge`），
> 主进程与渲染层依次接上；守卫是 `packages/agent/scripts/group-session-archive.test.mjs`
> 与 `app/desktop/tests/workspace_session_list.test.ts`。
>
> 本文回答四个问题：**为什么现在没有**、**归档怎么做**、
> **各层各改什么**、**哪些边界必须先定**。
>
> 对照实现：Agent Session 的归档（`AgentSessions.archive` / `LocalSessionStore.archive_session`）
> 已经存在，本文尽量与它同形——两处同类能力不该有两套语义。

---

## 一、病灶：同类能力只有一半

侧栏把 Agent Session 与 GroupSession 并排放在同一棵树里，两者除了归属与点击去向完全同形。
但归档只存在于 Agent Session 一侧：

| 能力 | Agent Session | GroupSession |
| --- | --- | --- |
| `list` | ✅ | ✅ |
| `create` / `get` | ✅ | ✅ |
| `remove` | ✅ | ✅ |
| `archive` | ✅ | ❌ |
| `archived`（已归档列表） | ✅ | ❌ |
| `clean_archive`（清空归档） | ✅ | ❌ |

于是侧栏的批量归档只能作用于 Agent 会话。这不是「群聊不重要」，而是一处**能力缺口**：
群聊会话是独立实体（`GroupSessions` 持有自己的 store 与 metadata），它本该有与 Agent Session
对称的生命周期。

### 1.1 用户可见的表现

多选里混进一个群聊时，归档按钮当时被整批禁用（现已改为「只归档可归档的并如实报告」）。
那个临时处理是能力缺口的补丁，不是终态——补上归档之后它就该消失。

---

## 二、归档是什么

### 2.1 Agent Session 的做法：目录搬迁

```text
<sessions-root>/sessions/<origin_type>/<session_id>/           活动
<sessions-root>/archived-sessions/<origin_type>/<session_id>/  归档
```

`archive` 是一次目录搬迁：源不存在则报错、目标已存在则报错、搬迁前 `dispose` 运行时实例。
`archived` 读归档区，`clean_archive` 删整个归档区。**归档是物理隔离，不是一个布尔标记**：
它让「活动列表」天然只含活动项，不需要在每次查询里过滤。

### 2.2 GroupSession 沿用同一形状

```text
<group-root>/sessions/<session_id>/           活动
<group-root>/archived-sessions/<session_id>/  归档
```

GroupSession 没有 `origin_type` 分区（它的来源只有群聊一种），因此少一层。
其余完全对齐：搬迁、目标冲突检查、`dispose` 运行时实例。

**为什么沿用目录搬迁而不是加 `archived: true` 字段**：

1. 与 Agent Session 同形，两处读代码的人不用记两套规则；
2. 活动列表不需要过滤条件——`list_session_metadata()` 现在读 `sessions/` 目录，
   归档项搬到 `archived-sessions/` 之后它自然不含归档项，**零改动**；
3. `metadata.v` 不用升版本：归档与否由位置表达，不由 schema 表达。
   这一点很重要——升版本要写迁移，而迁移的失败面比一次目录搬迁大得多。

### 2.3 与 Agent Session 的一处有意差别

Agent Session 归档时要求 `origin_type`（默认 `chat`），因为它有多个来源分区。
GroupSession 的归档**不接受** `origin_type`：它的来源只有群聊，多一个参数只会让人猜该传什么。

---

## 三、各层改动

### 3.1 `packages/agent`（对外 API，需 patch:build）

**类型层** `types/group/GroupSession.ts`：

```ts
/** 归档一个 GroupSession 的结果。 */
export interface GroupSessionArchiveResult {
  /** 被归档的 GroupSession 标识。 */
  readonly session_id: string;
  /** 归档发生的时间戳。 */
  readonly archived_at: number;
}

/** 列出已归档 GroupSession 的输入。 */
export interface GroupSessionArchiveListInput {
  /** 只返回绑定到指定 Workspace 的归档群聊。 */
  readonly workspace_id?: string;
}

/** GroupSessions 集合公开能力。 */
export interface GroupSessions {
  // ...现有 create / get / list / remove
  /** 归档指定群聊上下文：从活动区迁入归档区。 */
  archive(session_id: string): Promise<GroupSessionArchiveResult>;
  /** 列出已归档的群聊上下文摘要。 */
  archived(input?: GroupSessionArchiveListInput): Promise<readonly GroupSessionSummary[]>;
  /** 永久清空当前 Group 的全部归档。 */
  clean_archive(): Promise<{ readonly removed_session_ids: readonly string[] }>;
}
```

**存储层** `types/group/GroupSessionStore.ts`：

```ts
export interface GroupSessionStore {
  // ...现有 session / has_session / list_session_metadata / remove_session
  /** 把一个活动 GroupSession 迁入归档区。 */
  archive_session(session_id: string): Promise<GroupSessionArchiveResult>;
  /** 列出归档区中的 Session metadata。 */
  list_archived_session_metadata(): Promise<GroupSessionHistoryMeta[]>;
  /** 删除归档区中的指定 Session。 */
  remove_archived_session(session_id: string): Promise<boolean>;
  /** 永久清空归档区。 */
  clean_archive(): Promise<{ readonly removed_session_ids: readonly string[] }>;
}
```

**实现层**：

- `group/storage/LocalGroupSessionStore.ts`：加上述方法（另加 `purge`，见 §4.1）。
  `session_path()` 抽成带区参数的私有方法（`session_path(session_id, area)`），
  活动区与归档区共用同一段拼接逻辑——两处各写一遍必然分叉。
  缓存键也要带区（`active:<id>` / `archived:<id>`）：同一个 id 在两个区各有一份视图，
  不分区的话归档后会拿到活动区的旧视图（路径指向已经不存在的目录）。
- `group/storage/LocalGroupSessionDataStore.ts`：构造参数加 `area`。
  它原本把 `sessions/` 写死在路径里，因此读不到归档区的 metadata。
  区由调用方给而不是在 DataStore 里判断：它只负责「某个目录里的一个 Session」，
  该在哪个区是集合层的事。
- `group/GroupSessions.ts`：`archive` 先 `dispose` 运行时实例再搬迁；
  `archived` / `clean_archive` 转发 store；活动列表与归档列表共用 `to_summaries` 投影。

**要守住的不变量**（与 Agent Session 一致）：

- 归档源不存在 → 报错，不静默成功；
- 归档目标已存在 → 报错，不覆盖（覆盖会丢掉一份真实数据）；
- **先查归档区再查活动区**：重复归档时活动区已经空了，先查它会报「not found」——
  而用户明明看得到那条群聊（在归档区），那句话只会让他以为数据丢了；
- 归档前 `dispose` 运行时实例（否则内存里的实例会继续往旧路径写）。

**已执行状态**：群聊执行中不允许归档尚未单独拦截。`GroupSession` 目前没有
`is_executing` 这样的公开判据，而 `prompt` 是异步调度、`stop()` 才是显式停止入口。
现状是归档会 `dispose` 运行时实例——正在跑的 Turn 会随之失去实例。
后续如果要拦住，应在 `GroupSessions.archive` 里加「有未收口 GroupTurn 则拒绝」的判断。

### 3.2 主进程 `AgentController`

加三个方法，与 Agent 侧同形：

```ts
async archive_group_session(group_id: string, session_id: string): Promise<void>
async list_archived_group_sessions(group_id: string): Promise<DesktopGroupSessionSummary[]>
async clean_group_session_archive(group_id: string): Promise<number>
```

归档后要 `remove_group_session_cache`（复用现有私有方法），与 `remove_group_session` 一致。

### 3.3 IPC 与 `DesktopApi`

`common/types/DesktopApi.ts` 的 `group` 命名空间加三个方法：

```ts
archive_session(group_id: string, session_id: string): Promise<void>;
list_archived_sessions(group_id: string): Promise<DesktopGroupSessionSummary[]>;
clean_session_archive(group_id: string): Promise<number>;
```

`main/index.ts` 与 `preload/index.ts` 加对应通道，命名沿用现有前缀（`group:`）。

### 3.4 渲染层

- `use_group_actions.ts` 加 `archive_group_session`，与 `remove_group_session` 同形
  （成功后 `upsert_group` + `reset_group_chat`，并处理「归档的正是当前打开的那条」）。
- `GroupSessionActionsMenu` 加「归档」项，与 `SessionActionsMenu` 对齐。
- 侧栏批量归档接上 `group` 分支，`archivable_count` 改为「全部选中项」——
  于是「含群聊时跳过并报告」那段逻辑**整体删掉**，那本来就是这个缺口的补丁。

---

## 四、必须先定的边界

### 4.1 删除 Group 时，它的群聊数据怎么办

**现状是一处已存在的缺陷**：`AgentController.remove_group` 只做三件事——
删注册表条目、从 City 移除、清进程内缓存。**它不清理 GroupSession 的磁盘数据。**

也就是说现在删掉一个 Group，它的群聊目录会留在磁盘上成为孤儿数据。加归档之前这不明显，
加了之后会变成一个真问题：归档区会永久积累无人认领的数据。

三种处理方式：

| 方式 | 含义 | 代价 |
| --- | --- | --- |
| A. 随 Group 一起删（**已定**） | 删 Group = 删它的全部会话与归档 | 不可逆；需要在确认框里说明 |
| B. 保留为孤儿 | 维持现状 | 磁盘只增不减；没有入口能再访问它们 |
| C. 保留但可恢复 | 需要「已删除 Group」的恢复入口 | 超出本次范围 |

**决定：A。** Group 是群聊的**所有者**，所有者消失时它拥有的数据不该继续存在。
现在这份数据已经无处可访问，留着只是磁盘泄漏。因为不可逆，确认框文案要同步说明。

### 4.2 归档后的群聊能不能再打开

Agent Session 归档后，`archived` 列表里的条目可以查看（`list_archived_sessions`），
但 Desktop 侧栏目前**没有**「已归档」入口——归档对用户是「从列表里收起来」。

GroupSession 保持一致：归档 = 从侧栏收起。本次**不做**已归档列表的 UI 入口
（与 Agent Session 现状对齐）。`archived` 能力先提供，供后续 UI 使用。

**决定：不做 UI 入口。** 归档对用户就是「从列表里收起来」，与 Agent Session 一致；
两处同类能力保持同一种语义，不先给其中一处开特例。

### 4.3 正在执行的群聊

与 Agent Session 一致：执行中不允许归档。Agent 侧的实现是
`assert_session_not_rewriting` + 运行时实例的 `is_executing()` 检查。
GroupSession 侧对应「有未收口的 GroupTurn」或成员正在执行——具体判据实现时确认。

---

## 五、验证

**`packages/agent` 单测**（新增，参照 `LocalSessionStore` 的归档测试）：

1. 归档后活动列表不含它、归档列表含它；
2. 归档不存在的群聊报错；
3. 重复归档报错（不覆盖）；
4. `clean_archive` 清空归档区且返回被删的 id；
5. 归档前后 metadata 不变（归档只改位置，不改内容）。

**渲染层守卫**：侧栏批量归档不再有「跳过群聊」的分支——那条断言反过来写，
变成「归档作用于全部选中项」。这一条同时守住「缺口已补上」这件事。

**手动目检**：群聊菜单里的归档、多选混选时的归档、归档后重启的列表状态。

---

## 六、实施顺序

1. `packages/agent` 类型 + 存储 + `GroupSessions`（含单测）
2. 主进程 + IPC + `DesktopApi`
3. 渲染层动作 + 菜单 + 侧栏批量
4. 删除 Group 时清理会话数据（§4.1 定下之后）
5. `pnpm patch:build -- --agent` + 两侧 typecheck + 全量测试

---

## 七、不做什么

- 不做已归档群聊的 UI 入口（与 Agent Session 现状对齐，见 §4.2）；
- 不给 GroupSession 加 `origin_type` 分区（它只有一种来源）；
- 不升 `metadata.v`（归档由位置表达，不由 schema 表达）；
- 不把 Group 归档做成「归档每个成员 Session」——群聊是独立实体，不是成员会话的投影。
