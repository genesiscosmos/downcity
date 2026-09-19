/**
 * Sidebar 中以 Workspace 为根节点的会话列表。
 *
 * ## 根节点是 Workspace，叶子是会话
 *
 * ```text
 * Workspace A  [▶ 24]─4─名称                    ⏳  ⋯   根：箭头 + 名称 + 菜单（状态落在它上面）
 *   └ 会话标题                  Agent 名  ⋯     叶子：缩进 12，标题 + 归属 + 菜单
 * ```
 *
 * 两种行都是 `default` 变体——与会话行同一套壳（行高 32、圆角、文字档位），
 * 差别只有根节点带一个展开箭头、叶子多一层缩进。层级**只由缩进表达**，
 * 行高不随层数变，字号也不变（每层 12，见 `SIDEBAR_TREE_INDENT`）。
 *
 * ## 为什么叶子上要写出 Agent 名
 *
 * 一个 Workspace 里通常有多个 Agent 的会话：Workspace 是共享资源容器，不是某个 Agent 的私产
 * （见 `docs/city-sdk-call-design.md`）。而**没有自定义头像的 Agent 默认都是同一个幽灵图标**，
 * 所以只靠头像分不出谁是谁——归属必须用文字表达。
 *
 * 归属放在**尾随元信息**而不是悬停才显形的 `tag`：`tag` 会让标题被永久压到 55% 宽
 * （那个上限与悬停无关），而会话标题恰恰是这一行最该读全的东西。
 * 尾随位是 `shrink-0`，标题因此保住 `flex-1`，两者按各自该有的优先级分空间。
 *
 * ## 根行为什么也带状态
 *
 * 折叠着的 Workspace 也必须能说“这一层里有事正在发生”，否则用户只能靠逐个展开去找
 * 哪个 Workspace 在跑。状态直接落在**行右端的菜单入口**上，与会话行完全同一套
 *（`RowMenuButton` 的 `status`）：需要用户注意的状态常显、其余随行 hover / 聚焦 / 展开显形。
 *
 * 因此行右端仍然只有**一个**交互目标——“状态”与“操作入口”是同一个按钮的两面，
 * 而不是并排两个图形。汇总规则同源（`pick_chat_row_status`），
 * 所以父行与子行不可能互相矛盾。
 *
 * ## 会话从哪来：只读目录，不读磁盘
 *
 * 数据源是 Session 目录（`sessions_by_workspace`），不再是文件系统。文件树已从侧栏移除，
 * 文件浏览保留在**对话里的文件链接**（就地在右侧「文件」域打开，见 `ChatFilePanel`）
 * 与 Markdown 链接的跨 Workspace 路由。因此这一层没有懒加载、没有 IPC，
 * 也没有“读到一半”的中间态——只有「还没水合」与「确实没有」两种，且必须分开表达。
 *
 * ## 投影为什么是“一次算全部”，而不是只算展开的
 *
 * Chat 侧栏只为**展开的那几个**主体建会话列表（见 `ChatSidebar` 的 `build_subject_conversations`），
 * 这里做不到：父行的汇总状态要求折叠的 Workspace 也有结果。
 *
 * 代价可控，因为投影只产出**数据**（Agent 摘要 + 状态），不含任何 React 元素：
 * 菜单元素仍然只在展开时按行构造，而菜单才是那份投影里真正贵的部分。
 * 收益是父行与子行共用同一份投影，不可能出现“父行安静而子行在转圈”。
 */

import { useMemo, useState } from "react";
import { TbFolderPlus, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { RowMenuButton } from "@/components/RowMenuButton";
import { SessionActionsMenu } from "@/features/chat/components/SessionActionsMenu";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { pick_chat_row_status, resolve_chat_row_status, type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { resolve_chat_session_live_status } from "@/features/chat/lib/chat_runtime_projection";
import { select_workspace_sessions } from "@/features/chat/lib/session_list_projection";
import { get_session_unread_attention } from "@/lib/notification/notification_state";
import { use_translation } from "@/locales/i18n";
import type { DesktopController, DesktopWorkspaceSession } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatRuntime, DesktopSessionSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { SidebarContent } from "./SidebarPanel";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarItem, SidebarSubText } from "./SidebarItem";
import { WorkspaceRowMenu } from "./WorkspaceRowMenu";

/**
 * 一条已解析的 Workspace 会话行。
 *
 * `agent` 与 `status` 都在这里算好：父行只读 `status`，子行两个都读，
 * 两边共用同一份结果。
 */
interface WorkspaceSessionRow {
  /** 执行该会话的 Agent 标识。 */
  agent_id: string;
  /** 会话摘要。 */
  session: DesktopSessionSummary;
  /** 归属 Agent；已被删除时为空。 */
  agent?: DesktopAgentSummary;
  /** 这一行的完整状态。 */
  status: ChatRowStatus;
}

/** Workspace 会话列表属性。 */
interface WorkspaceSessionListProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 已登记的 Workspace。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 全部 Agent；用于把会话的 `agent_id` 变成可读名字。 */
  agents: DesktopAgentSummary[];
  /** 当前 MainView 打开的 Workspace。 */
  selected_workspace_id?: string;
  /** 当前 MainView 打开的会话；用于标记当前项。 */
  selected_session_id?: string;
  /** Catalog 是否仍在加载。 */
  loading: boolean;
  /** Session 目录是否已水合；未水合时不能把「还没读到」说成「没有会话」。 */
  hydrated: boolean;
  /** 各 Workspace 的 Session 目录。 */
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 实时运行态，用于逐条状态。 */
  chat_runtimes: Record<string, DesktopChatRuntime>;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 打开添加 Workspace 对话框。 */
  open_create_workspace(): void;
}

/**
 * 渲染 Workspace 会话树。
 *
 * 展开状态由本层持有（每行只上报意图）：一次能展开几个没有物理约束——
 * 它们是嵌在列表流里的普通子节点，互不遮挡，因此不像 Chat 主体行那样需要
 * 「浮动至多一个」的限制（见 `subjectCard.ts` 的 `OpenPanels`）。
 *
 * **当前所在的那个 Workspace 初始就是展开的**：侧栏切走再切回来会重新挂载，
 * 若一律从“全部折叠”开始，用户在会话里点一下 Workspace 图标就看不到自己刚才在哪一条。
 * 只做初始值而不做成派生值：派生会让“手动折叠当前 Workspace”变得做不到。
 */
export function WorkspaceSessionList(props: WorkspaceSessionListProps) {
  const translate = use_translation();
  const translate_resources = use_translation("resources");
  const [expanded_ids, set_expanded_ids] = useState<ReadonlySet<string>>(() => new Set(props.selected_workspace_id ? [props.selected_workspace_id] : []));
  const toggle_workspace = (workspace_id: string) => set_expanded_ids((current) => {
    const next = new Set(current);
    if (!next.delete(workspace_id)) next.add(workspace_id);
    return next;
  });
  const { agents, chat_runtimes, hydrated, notification_state, sessions_by_workspace, workspaces } = props;

  /**
   * 每个 Workspace 的会话行（含已解析状态）。父行汇总与子行渲染共用这一份。
   *
   * 未水合时返回空表：那时候一个会话都还没读到，汇总结果会是“没事发生”——
   * 而真实情况是“还不知道”，两者不能混为一谈（与空态同一个道理）。
   */
  const rows_by_workspace = useMemo(() => {
    const map = new Map<string, WorkspaceSessionRow[]>();
    if (!hydrated) return map;
    for (const workspace of workspaces) {
      map.set(workspace.workspace_id, select_workspace_sessions(sessions_by_workspace, workspace.workspace_id, (workspace_id, agent_id, session) => (
        resolve_chat_session_live_status(chat_runtimes[get_session_key(workspace_id, agent_id, session.session_id)], session.executing)
      )).map((row) => ({
        agent_id: row.agent_id,
        session: row.session,
        agent: agents.find((item) => item.agent_id === row.agent_id),
        // 实时优先于未读：Runtime 描述此刻正在发生的事，未读只是过去的结果（见 chat_row_status）。
        status: resolve_chat_row_status(row.live_status, get_session_unread_attention(notification_state, workspace.workspace_id, row.agent_id, row.session.session_id)),
      })));
    }
    return map;
  }, [agents, chat_runtimes, hydrated, notification_state, sessions_by_workspace, workspaces]);

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
      const rows = rows_by_workspace.get(workspace.workspace_id) ?? empty_rows;
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
          // 汇总状态交给**菜单入口本身**（与会话行完全同一套）：
          // 需要用户注意的状态常显、其余随行 hover / 聚焦 / 展开显形，
          // 行右端因此仍然只有一个交互目标。
          menu={<WorkspaceRowMenu workspace={workspace} status={status} on_remove={props.controller.actions.remove_workspace} />}
          // 双击标题才折叠/展开：挂在整行上的话，双击箭头会先切换一次、
          // 再冒泡上来切回原状，看起来像“双击没反应”。
          onDoubleClick={toggle}
          onSelect={() => props.controller.actions.select_workspace(workspace.workspace_id)}
        />
        {expanded ? <WorkspaceSessions
          controller={props.controller}
          workspace_id={workspace.workspace_id}
          rows={rows}
          hydrated={props.hydrated}
          selected_session_id={props.selected_session_id}
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
 * 与 `empty_conversations` 同理：每次渲染新建一个 `[]` 会让下游按引用比较的
 * memo 全部失效。没有会话的 Workspace 是常见情形，不能每帧现造。
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
 * | 会话所属 Agent 已删除 | 行照常渲染，只是没有归属文字 |
 *
 * 第三种不额外说明：会话本身还在、还能打开，Agent 名字缺失不影响“这是哪条对话”，
 * 而多一句解释会把一行文字变成一段说明。
 */
function WorkspaceSessions({ controller, workspace_id, rows, hydrated, selected_session_id }: {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 当前 Workspace 标识。 */
  workspace_id: string;
  /** 已解析的会话行。 */
  rows: readonly WorkspaceSessionRow[];
  /** Session 目录是否已水合。 */
  hydrated: boolean;
  /** 当前打开的会话标识。 */
  selected_session_id?: string;
}) {
  const translate = use_translation("navigation");
  const translate_common = use_translation();
  if (!hydrated) return <SidebarSubText indent={1}><TbLoader2 className="size-3 animate-spin" />{translate_common("state.loading")}</SidebarSubText>;
  if (rows.length === 0) return <SidebarSubText indent={1}>{translate("sidebar.no_sessions")}</SidebarSubText>;
  return <div className="space-y-0.5">{rows.map(({ agent_id, agent, session, status }) => <SidebarItem
    key={`${agent_id}:${session.session_id}`}
    variant="default"
    tree={{ indent: 1 }}
    // 「当前所在的会话」不是导航到另一个页面，因此用 true 而不是 page。
    currentKind="true"
    active={selected_session_id === session.session_id}
    title={session.title || translate("sidebar.new_chat")}
    // 归属文字常显：默认头像全都一样，没有它就无法在同一个 Workspace 里分辨会话属于谁。
    // 宽度封在 6rem：再长的 Agent 名也不该把标题挤没，截断后仍有原生 title 兜住全名。
    trailing={agent ? <span className="block max-w-24 truncate">{agent.name}</span> : undefined}
    // `true` = 保留当前侧栏。Workspace 侧栏里的会话是这个 Workspace 的入口，
    // 点一条就跳到 Chat 侧栏等于把用户从他刚才看的那棵树上扯走（与 Chat 侧栏自己的行为一致）。
    onSelect={() => void controller.actions.select_session(workspace_id, agent_id, session.session_id, true)}
    menu={<SessionActionsMenu
      session={session}
      trigger={<RowMenuButton status={status} label={translate_common("actions.more")} />}
      on_rename={(title) => controller.actions.rename_session(workspace_id, agent_id, session.session_id, title)}
      on_archive={() => controller.actions.archive_session(workspace_id, agent_id, session.session_id)}
      on_remove={() => controller.actions.remove_session(workspace_id, agent_id, session.session_id)}
    />}
  />)}</div>;
}
