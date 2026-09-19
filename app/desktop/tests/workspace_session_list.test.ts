/**
 * @file Workspace 侧栏「Workspace → 会话」列表的结构守卫。
 *
 * ## 背景
 *
 * Workspace 侧栏原本是一棵**文件树**（Workspace → 目录 → 文件），它回答了
 * 「这个 Workspace 里有什么」，但 Workspace 一级导航真正该回答的是
 * 「我在这里聊过什么」——文件浏览已经在对话里的文件链接与右侧「文件」域里有了入口。
 *
 * ## 这轮守什么
 *
 * 1. **树还在，但叶子换成了会话**：根节点仍是 Workspace（有箭头、有操作菜单），
 *    展开后列出该 Workspace 的会话，而不是文件系统条目。
 * 2. **文件树的入口真的没了**：目录树组件与它专用的 IPC（`list_entries`）一并删除，
 *    否则就是留了第二套读磁盘的路径，而界面上已经没人用它。
 * 3. **会话行的归属必须常显**：同一个 Workspace 里会有多个 Agent 的会话，
 *    而没有自定义头像的 Agent 默认都是同一个幽灵图标——归属只能靠文字。
 * 4. **加载态与空态分开**：Session 目录尚未水合时不能说「暂无对话」。
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

test("根节点是 Workspace，叶子是会话", () => {
  // 根节点仍是带箭头的 Workspace 行；它自己的操作菜单在下面那条测试里单验（含状态）。
  assert.ok(/tree=\{\{\s*disclosure: \{ expanded, label: translate_resources\(expanded \? "workspace\.collapse" : "workspace\.expand"\), onToggle: toggle \}/.test(session_list), "Workspace 根节点不再是可展开的树行");
  // 展开后是会话，不是文件系统条目。
  assert.ok(/select_workspace_sessions\(sessions_by_workspace, workspace\.workspace_id/.test(session_list), "会话列表不是从 Session 目录投影出来的");
  assert.ok(!/list_entries|read_entries|DirectoryChildren|TbFile\b|TbFolder\b/.test(session_list), "会话列表里又出现了文件系统读取或文件图标");
  // 缩进由 tree 参数给，深度固定为一层。
  assert.ok(/tree=\{\{ indent: 1 \}\}/.test(session_list), "会话行没有缩进：层级读不出来");
});

test("根行的状态落在菜单入口上，不额外加第二个图形", () => {
  // 汇总规则取自共享词表，不是就地写一个“谁更重要”。
  assert.ok(/pick_chat_row_status\(rows\.map\(\(row\) => row\.status\)\)/.test(session_list), "根行没有汇总它下面的会话状态");
  assert.ok(/export function pick_chat_row_status\(/.test(read_without_comments(path.join(renderer_root, "features/chat/lib/chat_row_status.ts"))), "行状态汇总不是共享函数：父行与子行会分叉");
  // 状态交给菜单入口本身：与会话行同一套，行右端只有一个交互目标。
  assert.ok(/<WorkspaceRowMenu workspace=\{workspace\} status=\{status\} on_remove=\{props\.controller\.actions\.remove_workspace\} \/>/.test(session_list), "根行没有把汇总状态交给菜单入口");
  const menu = read_without_comments(path.join(sidebar_root, "WorkspaceRowMenu.tsx"));
  assert.ok(/<RowMenuButton status=\{status\} label=\{translate\("workspace\.item_actions"/.test(menu), "Workspace 菜单入口没有接行状态");
  // 行右端不得再出现第二个状态图形（曾经的写法是一个 <span> + 菜单并排）。
  assert.ok(!/ChatStatusIcon/.test(session_list), "列表里又直接渲染了状态图标：行右端会变成两个图形");
  assert.ok(!/menu=\{<div/.test(session_list), "菜单位又包了一层容器：状态应该就在菜单按钮上");
  // 父行与子行必须读同一份投影，否则会出现“父行安静而子行在转圈”。
  assert.ok(/const rows = rows_by_workspace\.get\(workspace\.workspace_id\) \?\? empty_rows;/.test(session_list), "父行与子行不是读同一份投影");
  assert.ok(/const empty_rows: readonly WorkspaceSessionRow\[\] = \[\];/.test(session_list), "没有共享空行表：无会话的 Workspace 会每帧新建数组");
});

test("会话行用 default 变体，归属文字常显且封宽", () => {
  // 与会话行同一套壳：会话列表里的行不另立一种行高。
  assert.ok(/variant="default"/.test(session_list), "会话行不是 default 变体");
  assert.ok(/currentKind="true"/.test(session_list), "当前会话没有用 aria-current=true 表达");
  // 归属用 trailing（常显）而不是 tag（悬停才显形，且会把标题压到 55% 宽）。
  assert.ok(/trailing=\{agent \? <span className="block max-w-24 truncate">\{agent\.name\}<\/span> : undefined\}/.test(session_list), "会话行没有常显的 Agent 归属，或归属没有封宽");
  assert.ok(!/\btag=\{/.test(session_list), "会话行用了 tag：标题会被永久压窄，而它才是这行最该读全的东西");
  // 标题空时给兜底文案，而不是渲染一条空行。
  assert.ok(/session\.title \|\| translate\("sidebar\.new_chat"\)/.test(session_list), "空标题没有兜底文案");
  // 状态走共享的行状态与操作菜单，不另起一套。
  assert.ok(/<RowMenuButton status=\{status\} label=\{translate_common\("actions\.more"\)\} \/>/.test(session_list), "会话行的操作入口没有行状态");
  assert.ok(/<SessionActionsMenu/.test(session_list), "会话行没有复用共享的会话操作菜单");
});

test("加载态与空态分开，且都不冒充“没有会话”", () => {
  // 未水合 → 加载；已水合且为空 → 暂无对话。两者文案与结构都不同。
  assert.ok(/if \(!hydrated\) return <SidebarSubText indent=\{1\}><TbLoader2 className="size-3 animate-spin" \/>/.test(session_list), "未水合时没有单独的加载态");
  assert.ok(/if \(rows\.length === 0\) return <SidebarSubText indent=\{1\}>\{translate\("sidebar\.no_sessions"\)\}<\/SidebarSubText>/.test(session_list), "没有会话时没有空态");
  // 未水合时不汇总：那时一个会话都还没读到，汇总结果会是“没事发生”。
  assert.ok(/if \(!hydrated\) return map;/.test(session_list), "未水合时仍在汇总状态：会把“还不知道”说成“没事发生”");
  // 副文本对齐到同级行的文字线：缩进按 tree 的层进算，不是 0。
  assert.ok(/<SidebarSubText indent=\{1\}/.test(session_list), "副文本没有对齐到会话行的文字线");
});

test("点会话保留 Workspace 侧栏，且当前项两级都认得出", () => {
  // 第四个参数 `true` = 保留当前侧栏。缺了它，在 Workspace 侧栏点一条会话会把用户
  // 弹回 Chat 侧栏——而他刚才正在看这棵会话树。
  assert.ok(/controller\.actions\.select_session\(workspace_id, agent_id, session\.session_id, true\)/.test(session_list), "点会话没有保留当前侧栏：用户会被弹回 Chat");
  // 父行的高亮必须认「任何带 workspace_id 的目标」，否则在 Workspace 里打开一条会话时
  // 父行反而不高亮了。
  assert.ok(/const selected_workspace_id = selection && "workspace_id" in selection \? selection\.workspace_id : undefined;/.test(sidebar), "Workspace 行的高亮只认 workspace 页，漏掉了会话目标");
  assert.ok(/const selected_session_id = selection\?\.kind === "session" \? selection\.session_id : undefined;/.test(sidebar), "没有把当前会话传给列表");
  // 切回侧栏时当前 Workspace 初始就是展开的，否则看不到自己刚才在哪一条。
  assert.ok(/useState<ReadonlySet<string>>\(\(\) => new Set\(props\.selected_workspace_id \? \[props\.selected_workspace_id\] : \[\]\)\)/.test(session_list), "当前 Workspace 没有初始展开：切回侧栏看不到当前会话");
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

test("两个侧栏共用同一条会话排序", () => {  const projection = read_without_comments(path.join(renderer_root, "features/chat/lib/session_list_projection.ts"));
  // 排序只有一处：Agent 视角与 Workspace 视角各写一份，同一个会话会在两个侧栏里落在不同位置。
  assert.ok(/function compare_session_rows\(/.test(projection), "会话排序不是共享函数");
  assert.equal((projection.match(/\.sort\(compare_session_rows\)/g) ?? []).length, 2, "排序没有同时被两个投影复用");
  assert.ok(/export function select_workspace_sessions\(/.test(projection), "没有 Workspace 视角的会话投影");
  // Workspace 视角必须交出 agent_id：同一个 Workspace 里会有多个 Agent 的会话。
  assert.ok(/Array<\{ agent_id: string; session: DesktopSessionSummary; live_status: ChatLiveStatus \| null \}>/.test(projection), "Workspace 视角的投影没有交出 agent_id");
});
