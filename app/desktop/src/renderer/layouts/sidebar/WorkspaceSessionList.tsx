/**
 * Works 侧栏：以 Workspace 为根节点、会话为叶子的列表。
 *
 * ## 根是 Workspace，叶子是会话
 *
 * ```text
 * Workspace A  [▶ 24]─4─名称                    [＋] [⋯]   根：箭头 + 名称 + 新建 + 菜单
 *   └ [头像▾] 会话标题                            [⋯]     叶子：缩进 12，归属头像 + 标题 + 菜单
 * ```
 *
 * 两种行都是 `default` 变体——同一套壳（行高 32、圆角、文字档位），差别只有根节点带展开箭头、
 * 子行多一层缩进。层级**只由缩进表达**，行高不随层数变，字号也不变（每层 12）。
 *
 * ## 会话的入口只在这里
 *
 * Agents 侧栏不再列会话，因此这一棵树是唯一的会话视图，它同时收两类会话：
 *
 * | 来源 | 取数 | 归属 | 点击去向 |
 * | --- | --- | --- | --- |
 * | Agent Session | `sessions_by_workspace` | Agent 头像 | `select_session`（保留当前侧栏） |
 * | GroupSession | `group.sessions`（自带 `workspace_id`） | Group 头像 | `open_group` |
 *
 * 两类都按「实时优先、其次最近更新」排在同一条时间轴上（规则在 `session_list_projection`）。
 *
 * ## 归属是行首的头像，不是行尾的文字
 *
 * 归属原本写在行右端，那个位置一直在跟标题抢宽度，而标题才是这一行最该读全的东西。
 * 改成行首头像后，归属只占一格（与根节点的箭头同格，因此文字线不变），标题拿到整行。
 * 代价是**没有自定义头像的 Agent 都是同一张幽灵脸**，这一点由头像的 tooltip 与
 * 可访问名称补上（见 `SessionSubjectAvatar`）。
 *
 * ## 这一层只渲染，投影在容器里
 *
 * 会话行的投影（取数、排序、归属、状态）由 `WorkspaceSidebar` 算好传下来。原因不是分层洁癖：
 * 多选的范围选择必须按**用户看到的行序**取连续段，而那份顺序只存在于投影里。
 * 两处各算一遍，范围选择就会选中与看到的不一致的行。
 *
 * ## 根行为什么也带状态
 *
 * 折叠着的 Workspace 也必须能说「这一层里有事正在发生」，否则用户只能靠逐个展开去找
 * 哪个 Workspace 在跑。状态直接落在**行右端的菜单入口**上，与会话行完全同一套
 *（`RowMenuButton` 的 `status`）：需要用户注意的状态常显、其余随行 hover / 聚焦 / 展开显形。
 *
 * 因此行右端仍然只有**一个**交互目标——“状态”与“操作入口”是同一个按钮的两面。
 * 汇总规则同源（`pick_chat_row_status`），所以父行与子行不可能互相矛盾。
 */

import { useState } from "react";
import { TbChevronDown, TbCircle, TbCircleCheckFilled, TbFolderPlus, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RowMenuButton } from "@/components/RowMenuButton";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { GroupSessionActionsMenu } from "@/features/chat/components/GroupSessionActionsMenu";
import { pick_chat_row_status } from "@/features/chat/lib/chat_row_status";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { WorkspaceSessionRow } from "./workspaceSessionRows";
import { sidebar_tree_leading_icon_class_name } from "./sidebarRow";
import { SidebarContent } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarItem, SidebarSubText } from "./SidebarItem";
import { NewChatButton } from "./NewChatRow";
import { SessionSubjectAvatar } from "./SessionSubjectAvatar";
import type { SessionSelection } from "./use_session_selection";
import { format_expanded_ids, parse_expanded_ids, resolve_initial_expanded_ids, workspace_expanded_storage_key } from "./workspaceExpansion";
import { next_page_count, resolve_must_include_index, resolve_visible_count } from "./workspaceSessionPaging";
import { WorkspaceRowMenu } from "./WorkspaceRowMenu";

/** Works 侧栏属性。 */
interface WorkspaceSidebarListProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 已登记的 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 全部 Agent；用于 Group 头像拼成员。 */
  agents: DesktopAgentSummary[];
  /** 已投影的会话行，按 Workspace 索引；父行汇总与子行渲染共用这一份。 */
  rows_by_workspace: ReadonlyMap<string, readonly WorkspaceSessionRow[]>;
  /** 每个 Workspace 新建对话时的默认联系人。 */
  default_agent_ids: ReadonlyMap<string, string>;
  /** 当前 MainView 打开的 Workspace。 */
  selected_workspace_id?: string;
  /** 当前 MainView 打开的会话；用于标记当前项。 */
  selected_session_id?: string;
  /** 当前打开的会话 key（与行内 `entry.key` 同套）；分页窗口用它保证当前项可见。 */
  active_session_key?: string;
  /** Catalog 是否仍在加载。 */
  loading: boolean;
  /** Session 目录是否已水合；未水合时不能把「还没读到」说成「没有会话」。 */
  hydrated: boolean;
  /** 打开添加 Workspace 对话框。 */
  open_create_workspace(): void;
  /** 在一个 Workspace 里打开空对话（草稿）；`agent_id` 是默认联系人。 */
  on_open_draft(workspace_id: string, agent_id: string): void;
  /** 多选状态与动作。 */
  session_selection: SessionSelection;
}

/**
 * 渲染 Workspace 会话树。
 *
 * 展开状态由本层持有（每行只上报意图）：一次能展开几个没有物理约束——
 * 它们是嵌在列表流里的普通子节点，互不遮挡。
 *
 * ## 展开状态是持久化的显示偏好
 *
 * 它存在 `localStorage`（与侧栏宽度同一层，见 `workspaceExpansion`），因为它是壳的显示偏好、
 * 不是业务数据。两件事因此都能保持：**切走再切回来**（侧栏重新挂载）与**重启**。
 *
 * 当前所在的 Workspace 在初始值里总是展开的（见 `resolve_initial_expanded_ids`）——
 * 用户在会话里点一下 Workspace 图标切回侧栏时，必须能看到自己刚才在哪一条。
 * 代价是手动折叠当前 Workspace 后重新挂载会重新展开；这是有意的取舍。
 */
export function WorkspaceSessionList(props: WorkspaceSidebarListProps) {
  const translate = use_translation();
  const translate_resources = use_translation("resources");
  // 惰性初始化：直接写在 useState 参数里会每次渲染都读一次 localStorage。
  const [expanded_ids, set_expanded_ids] = useState<ReadonlySet<string>>(() => resolve_initial_expanded_ids({
    stored_ids: parse_expanded_ids(localStorage.getItem(workspace_expanded_storage_key)),
    workspace_ids: props.workspaces.map((workspace) => workspace.workspace_id),
    selected_workspace_id: props.selected_workspace_id,
  }));
  const toggle_workspace = (workspace_id: string) => set_expanded_ids((current) => {
    const next = new Set(current);
    if (!next.delete(workspace_id)) next.add(workspace_id);
    // 写回存储：包括「全部折叠」——那是用户做过的选择，不该在重新挂载后回到默认。
    localStorage.setItem(workspace_expanded_storage_key, format_expanded_ids(next));
    return next;
  });
  /**
   * 每个 Workspace 已经加载了几条会话。
   *
   * 不持久化：它是**本次浏览的进度**，不是偏好。重启后回到一页更符合「最近 10 条」的初衷；
   * 而用户真正关心的「我在哪一条」由窗口覆盖规则保证可见（见 `workspaceSessionPaging`）。
   */
  const [loaded_counts, set_loaded_counts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const load_more = (workspace_id: string, current_count: number, total_count: number) => set_loaded_counts((current) => {
    const next = new Map(current);
    next.set(workspace_id, next_page_count(current_count, total_count));
    return next;
  });

  // 加载中就只显示「正在加载」：先把「还没有 Workspace」摆出来再换成列表，
  // 是把「还没读到」说成了「没有」——两句话的含义完全相反。
  if (props.loading && props.workspaces.length === 0) {
    return <SidebarContent>
      <SidebarEmptyState icon={<TbLoader2 className="animate-spin" />} title={translate("state.loading")} />
    </SidebarContent>;
  }

  return <SidebarContent class_name="space-y-1">
    {props.workspaces.map((workspace) => {
      const expanded = expanded_ids.has(workspace.workspace_id);
      const toggle = () => toggle_workspace(workspace.workspace_id);
      const rows = props.rows_by_workspace.get(workspace.workspace_id) ?? empty_rows;
      // 折叠时也显示：那正是它存在的理由（展开时子行已经各自表达过了）。
      const status = pick_chat_row_status(rows.map((row) => row.status));
      return <section key={workspace.workspace_id} className="space-y-0.5">
        <SidebarItem
          variant="default"
          active={props.selected_workspace_id === workspace.workspace_id}
          title={workspace.name}
          titleClassName="font-medium"
          // 根节点没有图标：它是这一列的标题性节点，图标留给它下面的条目。
          // 也不占图标位——整行没有图标时，空位会在箭头与名字之间留出一段空白。
          tree={{
            disclosure: { expanded, label: translate_resources(expanded ? "workspace.collapse" : "workspace.expand"), onToggle: toggle },
          }}
          // 新建入口在**菜单左边**：开一条新对话比管理这个 Workspace 更常用，常用的排外侧。
          // 它不属于会话列表，因此展开与否都显示——折叠时也能直接开一条。
          actions={<NewChatButton workspace_id={workspace.workspace_id} agent_id={props.default_agent_ids.get(workspace.workspace_id) ?? ""} on_open_draft={props.on_open_draft} />}
          // 汇总状态交给**菜单入口本身**（与会话行完全同一套）：
          // 需要用户注意的状态常显、其余随行 hover / 聚焦 / 展开显形，
          // 行右端因此仍然只有一个交互目标。
          // 「新建对话」也在这里给一份：行内的加号是 hover 才显形的快路径，
          // 菜单里这一条是可发现的那一份。
          menu={<WorkspaceRowMenu
            workspace={workspace}
            status={status}
            default_agent_id={props.default_agent_ids.get(workspace.workspace_id)}
            on_open_draft={props.on_open_draft}
            on_remove={props.controller.actions.remove_workspace}
          />}
          // 双击标题才折叠/展开：挂在整行上的话，双击箭头会先切换一次、
          // 再冒泡上来切回原状，看起来像“双击没反应”。
          onDoubleClick={toggle}
          onSelect={() => props.controller.actions.select_workspace(workspace.workspace_id)}
        />
        {expanded ? <WorkspaceSessions
          controller={props.controller}
          agents={props.agents}
          rows={rows}
          hydrated={props.hydrated}
          selected_session_id={props.selected_session_id}
          session_selection={props.session_selection}
          loaded_count={loaded_counts.get(workspace.workspace_id) ?? 0}
          on_load_more={() => load_more(workspace.workspace_id, resolve_visible_count({
            loaded_count: loaded_counts.get(workspace.workspace_id) ?? 0,
            total_count: rows.length,
            must_include_index: resolve_must_include_index({
              ordered_keys: rows.map((row) => row.entry.key),
              active_key: props.active_session_key,
              selected_keys: props.session_selection.selected_keys,
            }),
          }), rows.length)}
        /> : null}
      </section>;
    })}
    {!props.loading && props.workspaces.length === 0 ? <SidebarEmptyState
      icon={<TbFolderPlus />}
      title={translate_resources("workspace.empty")}
      action={<Button variant="primary" onClick={props.open_create_workspace}>{translate_resources("workspace.create")}</Button>}
    /> : null}
  </SidebarContent>;
}

/**
 * 空行表的共享引用。
 *
 * 每次渲染新建一个 `[]` 会让下游按引用比较的 memo 全部失效。没有会话的 Workspace 是常见情形，
 * 不能每帧现造。
 */
const empty_rows: readonly WorkspaceSessionRow[] = [];

/**
 * 一个已展开 Workspace 的会话列表。
 *
 * 三种非正常态分开表达，不合并：
 *
 * | 情形 | 表现 |
 * | --- | --- |
 * | 目录尚未水合 | 副文本 + 旋转图标 +「加载中…」 |
 * | 确实没有会话 | 副文本 +「暂无对话」 |
 * | 会话所属对象已删除 | 行照常渲染，只是归属头像退化成中性图标 |
 */
function WorkspaceSessions({ controller, agents, rows, hydrated, selected_session_id, session_selection, loaded_count, on_load_more, active_session_key }: {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 全部 Agent；Group 头像用它拼成员。 */
  agents: DesktopAgentSummary[];
  /** 已解析的会话行。 */
  rows: readonly WorkspaceSessionRow[];
  /** Session 目录是否已水合。 */
  hydrated: boolean;
  /** 当前打开的会话标识。 */
  selected_session_id?: string;
  /** 多选状态与动作。 */
  session_selection: SessionSelection;
  /** 用户已经加载到几条（含默认那一页）；未记录时为 0。 */
  loaded_count: number;
  /** 再加载一页。 */
  on_load_more(): void;
  /** 当前打开的会话 key；用于保证它在窗口内。 */
  active_session_key?: string;
}) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  if (!hydrated) return <SidebarSubText indent={1}><TbLoader2 className="size-3 animate-spin" />{translate_common("state.loading")}</SidebarSubText>;
  if (rows.length === 0) return <SidebarSubText indent={1}>{translate("sidebar.no_sessions")}</SidebarSubText>;
  /**
   * 这一组会话的顺序，用于范围选择。
   *
   * 只在本 Workspace 的会话之间取连续段：跨 Workspace 的范围会把折叠着的那些行也选中，
   * 而用户看不见它们。这与「层级里的一次选择」是同一件事。
   */
  const ordered_keys = rows.map((row) => row.entry.key);
  /**
   * 现在该显示几条。
   *
   * 窗口必须覆盖当前打开项与已选项（见 `workspaceSessionPaging`）：否则重启后恢复到第 30 条时
   * 侧栏里看不到自己在哪一条，多选也会把看不见的行算进去。
   */
  const visible_count = resolve_visible_count({
    loaded_count,
    total_count: rows.length,
    must_include_index: resolve_must_include_index({ ordered_keys, active_key: active_session_key, selected_keys: session_selection.selected_keys }),
  });
  const visible_rows = visible_count >= rows.length ? rows : rows.slice(0, visible_count);
  const hidden_count = rows.length - visible_rows.length;
  return <div className="space-y-0.5">{visible_rows.map(({ entry, agent, group, label, status }) => {
    const selected = session_selection.selected_keys.includes(entry.key);
    const in_selection = session_selection.selection_mode;
    return <SidebarItem
      key={entry.key}
      variant="default"
      tree={{
        indent: 1,
        // 行首是归属头像（与根节点的箭头同格）；归属对象已删除时它是一个中性图标。
        leading: <SessionSubjectAvatar
          kind={entry.kind}
          agent={agent}
          group={group}
          agents={agents}
          workspace_id={entry.workspace_id}
          subject_label={label ?? translate("sidebar.unknown_subject")}
          on_new_session={() => {
            if (entry.kind === "agent") void controller.actions.create_session(entry.workspace_id, entry.agent_id, true);
            else void controller.actions.create_group_session(entry.group_id, entry.workspace_id);
          }}
        />,
      }}
      // 「当前所在的会话」不是导航到另一个页面，因此用 true 而不是 page。
      currentKind="true"
      // 多选时「当前打开」让位给「已勾选」：同时亮两种底色读不出哪个是在选中的。
      active={in_selection ? selected : selected_session_id === entry.session.session_id}
      title={entry.session.title || translate("sidebar.new_chat")}
      // 多选模式下点击改为选择；Shift 点击取「锚点到这里」的连续段。
      onSelect={(event) => {
        if (in_selection) {
          session_selection.select(entry.key, { range: event.shiftKey, ordered_keys });
          return;
        }
        if (event.shiftKey) {
          session_selection.select(entry.key, { range: true, ordered_keys });
          return;
        }
        // 点击保留当前侧栏：Workspace 侧栏里的会话是这个 Workspace 的入口，
        // 点一条就跳走等于把用户从他刚才看的那棵树上扯走。
        if (entry.kind === "agent") void controller.actions.select_session(entry.workspace_id, entry.agent_id, entry.session.session_id, true);
        else void controller.actions.open_group(entry.group_id, entry.session.session_id);
      }}
      // 多选模式下右端换成勾选按钮，且**不提供** ⋯ 菜单：那一层是「对这条会话做什么」，
      // 而此刻用户已经在做一件更大的事（对一批会话做什么），两个操作层叠在一起只会互相干扰。
      menu={in_selection
        ? <Button
          size="icon"
          aria-pressed={selected}
          title={translate(selected ? "sidebar.deselect_session" : "sidebar.select_session")}
          aria-label={translate(selected ? "sidebar.deselect_session" : "sidebar.select_session")}
          onClick={(event) => {
            event.stopPropagation();
            session_selection.select(entry.key, { range: event.shiftKey, ordered_keys });
          }}
        >{selected ? <TbCircleCheckFilled className="text-primary" /> : <TbCircle />}</Button>
        : entry.kind === "agent"
          ? <SessionActionsMenu
            session={entry.session}
            trigger={<RowMenuButton status={status} label={translate_common("actions.more")} />}
            on_rename={(title) => controller.actions.rename_session(entry.workspace_id, entry.agent_id, entry.session.session_id, title)}
            on_archive={() => controller.actions.archive_session(entry.workspace_id, entry.agent_id, entry.session.session_id)}
            on_remove={() => controller.actions.remove_session(entry.workspace_id, entry.agent_id, entry.session.session_id)}
            on_enter_selection={() => session_selection.select(entry.key)}
          />
          : <GroupSessionActionsMenu
            session={entry.session}
            status={status}
            on_rename={(title) => controller.actions.rename_group_session(entry.group_id, entry.session.session_id, title)}
            on_archive={() => controller.actions.archive_group_session(entry.group_id, entry.session.session_id)}
            on_remove={() => controller.actions.remove_group_session(entry.group_id, entry.session.session_id)}
            on_enter_selection={() => session_selection.select(entry.key)}
          />}
    />;
  })}
  {/* 「更多」只在确实还有未列出的时候出现：它是一条**加载**入口，不是“全部对话”菜单——
      这里没有上限可绕过，所以直接再取一页比弹一个列表更直接。
      它住在会话列表的最后一行，与「新建对话」在根行上一样，都属于“对这一列做点什么”。 */}
  {/* 箭头走 `tree.leading`（与归属头像同格）而不是 `tree.icon`：后者会把文字往右推
      「图标 16 + 间距 4」，使这一行比上面的会话行多缩进一列。它在这一层是**行首图标**，
      不是名字的一部分；`tone="secondary"` 再把它弱化一档，与上面那些会话行区分开。 */}
  {hidden_count > 0 ? <SidebarItem
    variant="default"
    tree={{ indent: 1, leading: <span className={sidebar_tree_leading_icon_class_name}><TbChevronDown /></span> }}
    tone="secondary"
    // 多选时不收新行：已选项已经保证可见，再展开会让“选了多少”变得难以核对。
    disabled={session_selection.selection_mode}
    title={translate("sidebar.show_more_sessions", { count: hidden_count })}
    onSelect={on_load_more}
  /> : null}
</div>;
}
