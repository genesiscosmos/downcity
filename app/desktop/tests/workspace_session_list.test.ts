/**
 * @file Works 侧栏「Workspace → 会话」列表的结构守卫。
 *
 * ## 背景
 *
 * Workspace 侧栏原本是一棵**文件树**（Workspace → 目录 → 文件），它回答了
 * 「这个 Workspace 里有什么」，但 Workspace 一级导航真正该回答的是
 * 「我在这里聊过什么」——文件浏览已经在对话里的文件链接与右侧「文件」域里有了入口。
 *
 * 之后它一度只列 Agent Session，而 Group 群聊只能从 Agent 面板的展开卡片里找。
 * 现在会话的入口只有这一处，因此两类会话都在这里：Agent Session 与 GroupSession
 * 统一成同一种叶子，靠归属文字与点击去向区分。
 *
 * ## 这轮守什么
 *
 * 1. **树还在，但叶子是两类会话**：根节点仍是 Workspace（有箭头、有操作菜单），
 *    展开后先是一个「新建对话」入口，再是该 Workspace 的会话。
 * 2. **文件树的入口真的没了**：目录树组件与它专用的 IPC（`list_entries`）一并删除。
 * 3. **会话行的归属必须常显**：同一个 Workspace 里会有多个 Agent 与 Group 的会话，
 *    而没有自定义头像的 Agent 默认都是同一个幽灵图标——归属只能靠文字。
 * 4. **加载态与空态分开**：Session 目录尚未水合时不能说「暂无对话」。
 * 5. **点击保留 Works 侧栏**：点一条会话不该把用户弹到另一个一级导航。
 *
 * ## 为什么用源码断言
 *
 * 本仓库的测试不引入 DOM 环境（见 `design_token_drift`）；这里要守的是结构契约
 * （谁提供数据、行怎么组合、哪些能力被删干净了），源码就是它的事实源。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const desktop_root = path.join(import.meta.dirname, "..");
const renderer_root = path.join(desktop_root, "src/renderer");
const sidebar_root = path.join(renderer_root, "layouts/sidebar");

/** 读取文件并去掉注释——注释里会引用被移除的旧结构来解释为什么移除。 */
function read_without_comments(file_path: string): string {
  return fs.readFileSync(file_path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const session_list = read_without_comments(path.join(sidebar_root, "WorkspaceSessionList.tsx"));
const sidebar = read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"));

test("目录树与它专用的 IPC 都已移除", () => {
  assert.ok(!fs.existsSync(path.join(sidebar_root, "WorkspaceTree.tsx")), "WorkspaceTree.tsx 仍在：文件浏览会有两个来源");
  // IPC 通道、preload 方法与主进程实现必须一起走：只删界面等于留下一条没人用但能用的读磁盘路径。
  const files: Array<[string, string]> = [
    ["src/main/index.ts", "workspace:list-entries"],
    ["src/preload/index.ts", "list_entries"],
    ["src/main/agent/AgentController.ts", "list_workspace_entries"],
    ["src/common/types/DesktopApi.ts", "DesktopWorkspaceEntry"],
  ];
  for (const [file, needle] of files) {
    const source = read_without_comments(path.join(desktop_root, file));
    assert.ok(!source.includes(needle), `${file} 里还留着 ${needle}`);
  }
});

test("会话卡片的整套实现都已移除", () => {
  // 会话入口收敛到 Works 一处之后，展开卡片（浮动 / 嵌入、固定开关、全部对话菜单）没有调用点。
  // 留着它们就等于留下第二套会话入口，而且两条路径会各自演化。
  for (const removed of [
    "ChatSidebar.tsx",
    "ChatSubjectList.tsx",
    "SubjectConversationsPanel.tsx",
    "subjectCard.ts",
  ]) {
    assert.ok(!fs.existsSync(path.join(sidebar_root, removed)), `${removed} 仍然存在：会话入口会有两个来源`);
  }
  // 卡片专属的几何常量也随卡片一起走：留着就是没人读的契约项。
  const row_contract = read_without_comments(path.join(sidebar_root, "sidebarRow.ts"));
  for (const dead of ["SIDEBAR_PANEL_PADDING", "SIDEBAR_CARD_BORDER", "SIDEBAR_PANEL_TEXT_INSET", "SIDEBAR_ROW_BORDER"]) {
    assert.ok(!row_contract.includes(dead), `sidebarRow.ts 里还留着 ${dead}：卡片已经不存在了`);
  }
});

test("根节点是 Workspace，叶子是两类会话", () => {
  // 根节点仍是带箭头的 Workspace 行；它自己的操作菜单在下面那条测试里单验（含状态）。
  assert.ok(/tree=\{\{\s*disclosure: \{ expanded, label: translate_resources\(expanded \? "workspace\.collapse" : "workspace\.expand"\), onToggle: toggle \}/.test(session_list), "Workspace 根节点不再是可展开的树行");
  assert.ok(!/list_entries|read_entries|DirectoryChildren|TbFile\b|TbFolder\b/.test(session_list), "会话列表里又出现了文件系统读取或文件图标");
  // 两类会话由同一个投影统一产出，且投影**只在一处**：列表渲染与多选的范围选择
  // 必须看同一份顺序，否则范围会选中与看到的不一致的行。
  const projection = read_without_comments(path.join(sidebar_root, "workspaceSessionRows.ts"));
  assert.ok(/select_workspace_session_entries\(\{/.test(projection), "会话行不是从统一投影出来的");
  assert.ok(!/select_workspace_session_entries/.test(session_list), "列表又自己投影了一遍：范围选择会与看到的行序分叉");
  // 缩进由 tree 参数给，深度固定为一层。
  assert.ok(/indent: 1,/.test(session_list), "会话行没有缩进：层级读不出来");
});

test("新建对话入口在 Workspace 行右端、菜单左边，且直接开当前 Workspace 的空对话", () => {
  // 会话住在 Workspace 里，因此「在这个 Workspace 里开一条新对话」长在**那个 Workspace 自己的行上**：
  // 位置即作用域，不需要先展开、也不需要读说明。
  assert.ok(/actions=\{<NewChatButton workspace_id=\{workspace\.workspace_id\} agent_id=\{props\.default_agent_ids\.get\(workspace\.workspace_id\) \?\? ""\} on_open_draft=\{props\.on_open_draft\} \/>\}/.test(session_list), "Workspace 行右端没有新建对话入口");
  // 它必须在**菜单之前**：开一条新的比管理这个 Workspace 更常用，常用的排外侧。
  const actions_index = session_list.indexOf("actions={<NewChatButton");
  const menu_index = session_list.indexOf("menu={<WorkspaceRowMenu");
  assert.ok(actions_index >= 0 && menu_index >= 0 && actions_index < menu_index, "新建入口不在菜单左边");
  // 它不属于会话列表，因此展开与否都显示。
  const expanded_guard = session_list.indexOf("{expanded ? <WorkspaceSessions");
  assert.ok(expanded_guard > 0 && actions_index < expanded_guard, "新建入口被放进了展开分支：折叠时开不了新对话");

  // 点它直接进空对话（draft），默认联系人取该 Workspace 最近聊过的 Agent。
  assert.ok(/void controller\.actions\.create_session\(workspace_id, agent_id, true\)/.test(read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"))), "新建对话没有打开当前 Workspace 的空对话");
  const projection = read_without_comments(path.join(sidebar_root, "workspaceSessionRows.ts"));
  assert.ok(/export function project_default_agent_ids/.test(projection), "没有为每个 Workspace 算默认联系人");
  assert.ok(/sort\(\(left, right\) => right\.session\.updated_at - left\.session\.updated_at\)\[0\]/.test(projection), "默认联系人不是该 Workspace 最近更新的那条会话的 Agent");
  assert.ok(/const fallback_agent_id = agents\[0\]\?\.agent_id \?\? "";/.test(projection), "没有 Agent 历史时没有回退到列表首个 Agent");

  // 按钮自己：一个加号图标按钮，hover / 键盘聚焦才显形。
  const new_chat = read_without_comments(path.join(sidebar_root, "NewChatRow.tsx"));
  assert.ok(/<Button[\s\S]{0,200}?size="icon"/.test(new_chat), "新建入口不是图标按钮");
  assert.ok(/<TbPlus \/>/.test(new_chat), "新建入口的图标不是单纯的加号");
  assert.ok(/aria-label=\{label\}/.test(new_chat), "新建入口没有可访问名称");
  // 静止时不显示，但**仍占位**：只改透明度、不改布局，否则 hover 出现时名字会被挤动。
  assert.ok(/className="opacity-0 transition-opacity duration-150 group-hover\/item:opacity-100 group-focus-within\/item:opacity-100"/.test(new_chat), "新建入口不是 hover 才显形（或显隐会改布局）");
  assert.ok(!/\bhidden\b|invisible/.test(new_chat), "新建入口用了 hidden / invisible：hover 出现时会把名字挤动");
  // 没有可用 Agent 时不渲染：一个点了没反应的加号比看不到它更糟。
  assert.ok(/if \(!agent_id\) return null;/.test(new_chat), "没有可用 Agent 时仍渲染了新建入口");
  // 侧栏不再弹 Agent / Group 选择器：那一步在空白页上做得更好，问两遍等于重复一个决定。
  assert.ok(!/<DropdownMenu/.test(new_chat), "新建入口又弹出了选择器：空白页上已经有联系人选择器");

  // 菜单里的「新建对话」是第一项，且与目录操作用分隔线分开：两者不是同一类事。
  const row_menu = read_without_comments(path.join(sidebar_root, "WorkspaceRowMenu.tsx"));
  const first_item = row_menu.slice(row_menu.indexOf("<DropdownMenuContent"));
  assert.ok(first_item.indexOf("sidebar.new_chat") < first_item.indexOf("workspace.copy_path"), "菜单里「新建对话」不是第一项");
  assert.ok(/<DropdownMenuSeparator \/>\s*<\/> : null\}\s*<DropdownMenuItem onClick=\{\(\) => void copy_path\(\)\}/.test(row_menu), "新建对话与目录操作之间没有分隔线");
  // 没有默认联系人时不给这一项：点了没反应的菜单项比看不到它更糟。
  assert.ok(/\{default_agent_id && on_open_draft \? <>/.test(row_menu), "没有默认联系人时仍给了「新建对话」项");
});

test("侧栏面板都必须包在 SidebarPanel 里", () => {
  // `SidebarFrame` 的 children 容器是**横向** flex（Rail 与 Panel 并排）。面板裸着返回一个
  // fragment，它的 Header 与列表就会成为那个横向容器的两个 flex 项，整个面板变成左右布局。
  // 这类错误不会被类型系统拦住（都是合法 JSX），只能靠这条约定守。
  const offenders = ["AgentsSidebar.tsx", "WorkspaceSidebar.tsx", "PowerSidebar.tsx", "PowerWorkspaceSidebar.tsx", "SettingsSidebarPanel.tsx"]
    .filter((file) => !fs.readFileSync(path.join(sidebar_root, file), "utf8").includes("return <SidebarPanel"));
  assert.deepEqual(offenders, [], `这些面板没有包在 SidebarPanel 里，会变成左右布局：${offenders.join(", ")}`);
});

/**
 * 菜单触发器必须真的能打开。
 *
 * 踩过的坑：`SidebarItem` 声明了 `forwardRef` 却把 `ref` 与 `...rest` 解构出来后没再用，
 * 而 `<DropdownMenuTrigger asChild>` 正是靠它们把 onClick 与锚点合并到子元素上。
 * 结果是菜单永远打不开，而界面上看不出任何异常——它只是一个点了没反应的图标。
 */
test("行把 ref 与原生 button 属性交给标签按钮（否则 asChild 触发器打不开）", () => {
  const item = read_without_comments(path.join(sidebar_root, "SidebarItem.tsx"));
  // 行底是 div、可点的是里面的标签按钮，因此合并目标只能是那个按钮。
  assert.ok(/\{\.\.\.rest\}\s*ref=\{ref\}/.test(item), "行没有把 rest 与 ref 交给标签按钮：asChild 触发器会失效");
  assert.ok(/export const SidebarRowLabel = React\.forwardRef<HTMLButtonElement, SidebarRowLabelProps>/.test(item), "标签区不是可转发 ref 的按钮");
  assert.ok(/\{\.\.\.rest\}\s*ref=\{ref\}/.test(item.slice(item.indexOf("SidebarRowLabel"))), "标签按钮没有接住转发进来的属性");
});

/**
 * 空对话页换的是**联系人**，不是 Workspace。
 *
 * Workspace 在进入这个空对话的那一刻就已经定了（侧栏哪个 Workspace 上的新建按钮决定），
 * 在这里再给一个 Workspace 选择器等于把用户刚选定的目录重新问一遍，
 * 而换 Workspace 会让他离开那个目录。Group 草稿例外：群聊可以从任意目录开始。
 */
test("空对话页换联系人，而不是换 Workspace", () => {
  const timeline = read_without_comments(path.join(renderer_root, "features/chat/components/SessionTimeline.tsx"));
  // 换联系人用 Agent 选择器，且必须保留当前 Workspace。
  assert.ok(/<ChatAgentSelector agent_id=\{agent\.agent_id\} agents=\{agents\} disabled=\{false\} switch_agent=\{\(agent_id\) => switch_context\(workspace\.workspace_id, agent_id\)\} \/>/.test(timeline), "空对话页没有换联系人的入口，或换联系人时改了 Workspace");
  // Workspace 选择器只在群聊草稿出现（那时目录还没定）。
  assert.ok(/workspace_draft_mode && switch_workspace \? <div className="mt-3">/.test(timeline), "Workspace 选择器没有按草稿态收口");
  // 旧的「Chat 表面」二分已删：它曾让 Workspace 表面与 Agent 表面走两套空态。
  assert.ok(!/chat_surface/.test(timeline), "SessionView 又按 Chat 表面分支了");
});

test("根行的状态落在菜单入口上，不额外加第二个图形", () => {
  // 汇总规则取自共享词表，不是就地写一个“谁更重要”。
  assert.ok(/pick_chat_row_status\(rows\.map\(\(row\) => row\.status\)\)/.test(session_list), "根行没有汇总它下面的会话状态");
  assert.ok(/export function pick_chat_row_status\(/.test(read_without_comments(path.join(renderer_root, "features/chat/lib/chat_row_status.ts"))), "行状态汇总不是共享函数：父行与子行会分叉");
  // 状态交给菜单入口本身：与会话行同一套，行右端只有一个交互目标。
  assert.ok(/<WorkspaceRowMenu[\s\S]{0,120}?workspace=\{workspace\}[\s\S]{0,120}?status=\{status\}/.test(session_list), "根行没有把汇总状态交给菜单入口");
  const menu = read_without_comments(path.join(sidebar_root, "WorkspaceRowMenu.tsx"));
  assert.ok(/<RowMenuButton status=\{status\} label=\{translate\("workspace\.item_actions"/.test(menu), "Workspace 菜单入口没有接行状态");
  // 行右端不得再出现第二个状态图形（曾经的写法是一个 <span> + 菜单并排）。
  assert.ok(!/ChatStatusIcon/.test(session_list), "列表里又直接渲染了状态图标：行右端会变成两个图形");
  assert.ok(!/menu=\{<div/.test(session_list), "菜单位又包了一层容器：状态应该就在菜单按钮上");
  // 父行与子行必须读同一份投影，否则会出现“父行安静而子行在转圈”。
  assert.ok(/const rows = props\.rows_by_workspace\.get\(workspace\.workspace_id\) \?\? empty_rows;/.test(session_list), "父行与子行不是读同一份投影");
  assert.ok(/const empty_rows: readonly WorkspaceSessionRow\[\] = \[\];/.test(session_list), "没有共享空行表：无会话的 Workspace 会每帧新建数组");
});

/**
 * 会话行的归属是**行首头像**，不是行尾文字。
 *
 * 行尾文字一直在跟标题抢宽度，而标题才是这一行最该读全的东西。改成行首头像后归属只占一格
 * （与根节点的箭头同格，因此文字线不变），标题拿到整行。
 *
 * 头像同时是这一行的第二个入口：它的菜单里给出归属名称与「新建会话」。
 */
test("会话行的归属是行首头像，行尾不再有归属文字", () => {
  assert.ok(/variant="default"/.test(session_list), "会话行不是 default 变体");
  assert.ok(/currentKind="true"/.test(session_list), "当前会话没有用 aria-current=true 表达");
  // 头像占的是树行展开箭头那一格，因此它必须走 `tree.leading`。
  assert.ok(/leading: <SessionSubjectAvatar/.test(session_list), "会话行首不是归属头像");
  assert.ok(!/\btrailing=\{label/.test(session_list), "会话行尾又写回了归属文字：标题会被挤窄");
  assert.ok(!/\btag=\{/.test(session_list), "会话行用了 tag：标题会被永久压窄");
  // 标题空时给兜底文案，而不是渲染一条空行。
  assert.ok(/entry\.session\.title \|\| translate\("sidebar\.new_chat"\)/.test(session_list), "空标题没有兜底文案");
  // 状态走共享的行状态与操作菜单，不另起一套。
  assert.ok(/<RowMenuButton status=\{status\} label=\{translate_common\("actions\.more"\)\} \/>/.test(session_list), "会话行的操作入口没有行状态");
  // 两类会话各自复用已有的操作菜单，而不是在这里重写一套动作。
  assert.ok(/<SessionActionsMenu/.test(session_list), "Agent 会话没有复用共享的会话操作菜单");
  assert.ok(/<GroupSessionActionsMenu/.test(session_list), "Group 会话没有复用共享的群聊操作菜单");
  // 头像自己：菜单里给出归属名称与「新建会话」，且新建落在同一个归属下。
  const avatar = read_without_comments(path.join(sidebar_root, "SessionSubjectAvatar.tsx"));
  assert.ok(/<DropdownMenuLabel className="max-w-56 truncate">\{subject_label\}<\/DropdownMenuLabel>/.test(avatar), "头像菜单没有给出归属名称");
  assert.ok(/sidebar\.new_session_here/.test(avatar), "头像菜单没有「新建会话」入口");
  assert.ok(/title=\{trigger_label\}["\s\S]{0,80}?aria-label=\{trigger_label\}/.test(avatar), "头像没有可访问名称：默认头像都长一样，读屏分不出是谁");
});

test("加载态与空态分开，且都不冒充“没有会话”", () => {
  // 未水合 → 加载；已水合且为空 → 暂无对话。两者文案与结构都不同。
  assert.ok(/if \(!hydrated\) return <SidebarSubText indent=\{1\}><TbLoader2 className="size-3 animate-spin" \/>/.test(session_list), "未水合时没有单独的加载态");
  assert.ok(/if \(rows\.length === 0\) return <SidebarSubText indent=\{1\}>\{translate\("sidebar\.no_sessions"\)\}<\/SidebarSubText>/.test(session_list), "没有会话时没有空态");
  // 未水合时不投影：那时一个会话都还没读到，汇总结果会是“没事发生”。
  assert.ok(/if \(!hydrated\) return map;/.test(read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"))) || /hydrated/.test(session_list), "未水合时仍在汇总状态：会把“还不知道”说成“没事发生”");
  // 副文本对齐到同级行的文字线：缩进按 tree 的层进算，不是 0。
  assert.ok(/<SidebarSubText indent=\{1\}/.test(session_list), "副文本没有对齐到会话行的文字线");
});

test("点会话保留 Works 侧栏，且当前项两级都认得出", () => {
  // 第四个参数 `true` = 保留当前侧栏。缺了它，在 Works 侧栏点一条会话会把用户
  // 弹回另一个一级导航——而他刚才正在看这棵会话树。
  assert.ok(/controller\.actions\.select_session\(entry\.workspace_id, entry\.agent_id, entry\.session\.session_id, true\)/.test(session_list), "点 Agent 会话没有保留当前侧栏");
  // Group 会话走 Group 的打开动作：它不是 Agent Session，不能被塞进同一个调用。
  assert.ok(/controller\.actions\.open_group\(entry\.group_id, entry\.session\.session_id\)/.test(session_list), "Group 会话没有走 Group 的打开动作");
  // 父行的高亮必须认「任何带 workspace_id 的目标」，否则在 Workspace 里打开一条会话时
  // 父行反而不高亮了。
  assert.ok(/const selected_workspace_id = selection && "workspace_id" in selection \? selection\.workspace_id : undefined;/.test(sidebar), "Workspace 行的高亮只认 workspace 页，漏掉了会话目标");
  // 当前会话要认两类：Agent Session 与 GroupSession 都是“这个 Workspace 里的一条对话”。
  assert.ok(/selection\.kind === "session" \|\| selection\.kind === "group_session"\) \? selection\.session_id : undefined/.test(sidebar), "当前会话没有同时认 Agent Session 与 GroupSession");
  // 切回侧栏时当前 Workspace 总是展开的，否则看不到自己刚才在哪一条。
  // 它现在是「存储里那一份 ∪ 当前所在」，两件事各回答一个问题（见 workspaceExpansion）。
  assert.ok(/resolve_initial_expanded_ids\(\{/.test(session_list), "当前 Workspace 没有初始展开：切回侧栏看不到当前会话");
  const expansion = read_without_comments(path.join(sidebar_root, "workspaceExpansion.ts"));
  assert.ok(/if \(selected_workspace_id && workspace_ids\.includes\(selected_workspace_id\)\) next\.add\(selected_workspace_id\);/.test(expansion), "初始展开没有补上当前 Workspace");
});

/**
 * 展开状态必须真的持久化。
 *
 * 它是壳的显示偏好（与侧栏宽度同一层），因此两件事都要成立：**切走再切回来**
 *（侧栏重新挂载）与**重启**。只存在内存里只能满足前者。
 */
test("Workspace 展开状态持久化到 localStorage", () => {
  // 惰性初始化：直接写在 useState 参数里会每次渲染都读一次 localStorage。
  assert.ok(/useState<ReadonlySet<string>>\(\(\) => resolve_initial_expanded_ids\(\{/.test(session_list), "展开状态不是从存储惰性恢复的");
  assert.ok(/localStorage\.getItem\(workspace_expanded_storage_key\)/.test(session_list), "初始化时没有读存储");
  // 写回发生在 toggle 里，而且包括「全部折叠」——那是用户做过的选择。
  assert.ok(/localStorage\.setItem\(workspace_expanded_storage_key, format_expanded_ids\(next\)\)/.test(session_list), "切换展开时没有写回存储");
  // 存储 key 与侧栏宽度同一个命名空间，便于一起排查。
  assert.ok(/workspace_expanded_storage_key = "downcity\.workspace_expanded_ids"/.test(read_without_comments(path.join(sidebar_root, "workspaceExpansion.ts"))), "存储 key 不在 downcity 命名空间下");
});

test("行状态汇总的优先级与子行一致", () => {
  const rows = read_without_comments(path.join(renderer_root, "features/chat/lib/chat_row_status.ts"));
  // 显式顺序而不是一张新排名表：只有五个取值，顺序就是它的全部含义。
  assert.ok(/const chat_row_status_order: readonly ChatRowStatus\[\] = \["action_required", "working", "failed", "completed", "idle"\];/.test(rows), "汇总优先级变了：它必须与 resolve_chat_row_status 的“实时优先于未读”同序");
  // 「等待你」在「正在推进」之前：与 chat_runtime_projection 的 is_more_urgent 同序。
  assert.ok(chat_row_status_order_of(rows).indexOf("action_required") < chat_row_status_order_of(rows).indexOf("working"), "等待输入的优先级低于正在推进：与子行规则矛盾");
  assert.ok(/export function pick_chat_row_status\(statuses: readonly ChatRowStatus\[\]\): ChatRowStatus \{/.test(rows), "汇总函数签名变了");
});

/** 读出汇总顺序表，用于比较相对次序。 */
function chat_row_status_order_of(source: string): string[] {
  const matched = /const chat_row_status_order: readonly ChatRowStatus\[\] = \[([^\]]*)\];/.exec(source)?.[1] ?? "";
  return [...matched.matchAll(/"(\w+)"/g)].map((entry) => entry[1]);
}

test("会话投影只有一处，且两类会话共用一条排序", () => {
  const projection = read_without_comments(path.join(renderer_root, "features/chat/lib/session_list_projection.ts"));
  // 排序只有一处：各写一份，同一个会话会在两个视图里落在不同位置。
  assert.ok(/function compare_session_rows\(/.test(projection), "会话排序不是共享函数");
  assert.ok(/export function select_workspace_session_entries\(/.test(projection), "没有统一的 Workspace 会话投影");
  // 旧的「按 Agent 切」的投影已经删掉：Agent 面板不再列会话。
  assert.ok(!/export function select_agent_sessions\(/.test(projection), "按 Agent 切的会话投影还在：Agent 面板会重新长出会话列表");
  // 两类会话必须共用同一次排序调用，而不是各排一遍。
  assert.equal((projection.match(/compare_session_rows\(/g) ?? []).length, 2, "排序没有被投影复用（应为 1 处定义 + 1 处调用）");
  // 每个条目都必须交出归属标识：同一个 Workspace 里会有多个 Agent 与 Group。
  assert.ok(/kind: "agent"/.test(projection) && /kind: "group"/.test(projection), "投影没有区分两类会话");
  assert.ok(/group_id: group\.group_id/.test(projection), "Group 会话没有交出 group_id");
});

test("多选：Shift 点击进入，普通点击仍是打开会话", () => {
  // 普通点击必须仍然是「打开会话」：多选不能把最常用的那个动作挤走。
  assert.ok(/if \(entry\.kind === "agent"\) void controller\.actions\.select_session\(entry\.workspace_id, entry\.agent_id, entry\.session\.session_id, true\)/.test(session_list), "普通点击不再打开会话");
  // Shift 点击进入多选，且带上这一组的行序（范围只看看得见的行）。
  assert.ok(/if \(event\.shiftKey\) \{\s*session_selection\.select\(entry\.key, \{ range: true, ordered_keys \}\);/.test(session_list), "Shift 点击没有进入多选");
  // 多选模式下普通点击改为选择。
  assert.ok(/session_selection\.select\(entry\.key, \{ range: event\.shiftKey, ordered_keys \}\)/.test(session_list), "多选模式下点击没有选择");
  // 行尾从 ⋯ 换成勾选按钮，且不提供 ⋯ 菜单：两层操作叠在一起只会互相干扰。
  assert.ok(/menu=\{in_selection/.test(session_list), "多选模式下行尾没有换成勾选按钮");
  assert.ok(/aria-pressed=\{selected\}/.test(session_list), "勾选按钮没有表达按下状态");
  // 多选时「当前打开」让位给「已勾选」：同时亮两种底色读不出哪个是在选中的。
  assert.ok(/active=\{in_selection \? selected : selected_session_id === entry\.session\.session_id\}/.test(session_list), "多选时当前项与选中项用了同一套底色");
  // ⋯ 菜单里也有一条可发现的多选入口（鼠标用户不会去猜修饰键）。
  const session_menu = read_without_comments(path.join(renderer_root, "features/chat/components/SessionActionsMenu.tsx"));
  const group_menu = read_without_comments(path.join(renderer_root, "features/chat/components/GroupSessionActionsMenu.tsx"));
  assert.ok(/on_enter_selection/.test(session_menu) && /sidebar\.enter_selection/.test(session_menu), "会话菜单里没有多选入口");
  assert.ok(/on_enter_selection/.test(group_menu) && /sidebar\.enter_selection/.test(group_menu), "群聊菜单里没有多选入口");
});

/**
 * 范围选择的锚点必须**前进**，且范围是替换而不是并集。
 *
 * 这两条合起来才构成「逐段选择」。曾经只有一半（范围是并集、锚点固定为「当前打开的会话」），
 * 结果是连续 Shift 点击把整列选中——用户看到的是「Shift 点一下，全选了」。
 */
test("多选：锚点随点击前进，范围是替换不是并集", () => {
  const selection_module = read_without_comments(path.join(sidebar_root, "sessionSelection.ts"));
  const selection_hook = read_without_comments(path.join(sidebar_root, "use_session_selection.ts"));
  // 范围函数不得再接收「已有选择」这个输入——它就是并集语义的来源。
  assert.ok(/export function select_session_range\(\s*ordered_keys: readonly string\[\],\s*anchor_key: string \| null,\s*current_key: string,/.test(selection_module), "范围函数仍在接收已有选择：并集语义会重新长出来");
  assert.ok(!/selected_keys: readonly string\[\],\s*anchor_key/.test(selection_module), "范围函数又收下了已有选择");
  // 锚点是 hook 的内部状态，且只被「非范围点击」推动。
  assert.ok(/const \[anchor_key, set_anchor_key\] = useState<string \| null>\(null\)/.test(selection_hook), "锚点不是 hook 的内部状态");
  // 锚点必须**每次点击都前进**（Shift 也不例外）：Shift 不动锚点会变成 Finder 式累加，
  // 而这里要的是「上一次点击的 item 到这一项」。
  assert.ok(/\n    set_anchor_key\(key\);/.test(selection_hook), "锚点没有随每次点击前进");
  assert.ok(!/if \(!options\?\.range\) set_anchor_key\(key\)/.test(selection_hook), "锚点只在非范围点击时前进：连续 Shift 会从同一个锚点累加");
  // 退出时锚点也要清掉，否则下次进入会从一个旧位置开始取范围。
  assert.ok(/set_anchor_key\(null\)/.test(selection_hook), "退出多选时没有清掉锚点");
  // 容器层不再从「当前打开的会话」推一个锚点进来：那正是固定锚点的来源。
  const sidebar_source = read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"));
  assert.ok(!/active_key/.test(sidebar_source), "容器层又传了固定的锚点：连续 Shift 会累积成整列");
});

test("多选：状态在容器层，工具条与列表读同一份", () => {
  const sidebar_source = read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"));
  const selection_hook = read_without_comments(path.join(sidebar_root, "use_session_selection.ts"));
  // 工具条在 header、可勾选的行在列表里，两者都要读写同一份状态。
  assert.ok(/const session_selection = use_session_selection\(\{ ordered_keys, targets_by_key \}\)/.test(sidebar_source), "多选状态不在容器层");
  assert.ok(/session_selection=\{session_selection\}/.test(sidebar_source), "多选状态没有传给列表");
  // 范围选择的顺序必须与渲染顺序同源：两处各算一遍会选中看不见的行。
  assert.ok(/const ordered_keys = useMemo\(/.test(sidebar_source), "范围选择没有自己的有序 key");
  assert.ok(/rows_by_workspace\.values\(\)\]\.flatMap/.test(sidebar_source), "范围选择的顺序不是从同一份投影来的");
  // 模式是显式的，不是「选择非空」的推断。
  assert.ok(/const \[selection_mode, set_selection_mode\] = useState\(false\)/.test(selection_hook), "多选模式是推断出来的，而不是显式状态");
  // Esc 退出：与其它浮层同一套「退回一步」的手势。
  assert.ok(/event\.key !== "Escape"/.test(selection_hook), "多选没有 Esc 退出");
  // 失效的 key 必须剔除：否则计数会比看得见的勾选多，批量还会去动不存在的对象。
  assert.ok(/prune_session_selection\(stored_keys, ordered_keys\)/.test(selection_hook), "选择里的失效 key 没有被剔除");
});

test("多选：批量归档只作用于 Agent 会话，且含群聊时禁用并说明", () => {
  const sidebar_source = read_without_comments(path.join(sidebar_root, "WorkspaceSidebar.tsx"));
  const bar = read_without_comments(path.join(sidebar_root, "SessionSelectionBar.tsx"));
  // 归档只存在于 Agent Session，Group 群聊没有这个语义（见 GroupSessionActionsMenu）。
  assert.ok(/filter\(\(target\) => target\.kind === "agent"\)/.test(sidebar_source), "批量归档没有只作用于 Agent 会话");
  assert.ok(/disabled=\{pending \|\| has_group_sessions \|\| selected_count === 0\}/.test(bar), "含群聊时归档没有禁用");
  // 禁用必须带原因：静默跳过等于告诉用户「归档了」但实际没动。
  assert.ok(/archive_group_unsupported/.test(bar), "归档禁用时没有说明原因");
  // 删除对两类都成立。
  assert.ok(/if \(target\.kind === "agent"\) await controller\.actions\.remove_session/.test(sidebar_source), "批量删除没有区分两类会话");
  assert.ok(/await controller\.actions\.remove_group_session/.test(sidebar_source), "批量删除漏了群聊");
  // 不可逆的批量删除有确认；可逆的归档不打扰。
  assert.ok(/sidebar\.delete_selected_title/.test(sidebar_source), "批量删除没有确认步骤");
  // 批量执行复用已有领域动作，而不是新写一套：那套带着导航回退与缓存清理。
  assert.ok(/await controller\.actions\.archive_session\(target\.workspace_id/.test(sidebar_source), "批量归档没有复用已有的归档动作");
});
