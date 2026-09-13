/** Desktop Chat 运行态的跨 Session Agent 聚合投影。 */

import type { DesktopChatRuntime } from "@common/types/DesktopApi";
import type { ChatLiveStatus, DesktopTurnFileDiffSummary } from "@/types/DesktopView";

/** 仍占用 Session 执行槽位的运行阶段。 */
const executing_statuses = new Set<DesktopChatRuntime["status"]>(["submitted", "streaming", "waiting_input"]);

/** 只表达「Turn 正阻塞等待用户」的运行阶段。 */
const waiting_statuses = new Set<DesktopChatRuntime["status"]>(["waiting_input"]);

/**
 * 把 Session 运行态投影为行内实时状态；不占用执行槽时返回 null。
 *
 * waiting 先于 working 判断：`waiting_input` 同样占用执行槽，但它要表达的是「该你说话了」，
 * 而不是「正在工作」——两者共用 Spinner 会把等待输入说成进展。
 *
 * `catalog_executing` 只在尚未收到 Runtime 时生效；Runtime 一旦存在就是当前事实，即使它表示
 * 已结束，也不能再回退到目录快照里的旧执行标记，否则会显示已经结束的对话仍在运行。
 */
export function resolve_chat_session_live_status(
  runtime?: DesktopChatRuntime,
  catalog_executing = false,
): ChatLiveStatus | null {
  if (!runtime) return catalog_executing ? "working" : null;
  if (waiting_statuses.has(runtime.status)) return "action_required";
  return executing_statuses.has(runtime.status) ? "working" : null;
}

/**
 * 只返回属于当前 Runtime Turn 的实时文件改动。
 *
 * Session 级缓存会保留上一轮的最终摘要；新 Turn 的首条 file_diff mutation 到达前，
 * 必须按 turn_id 隔离，避免 Thinking 状态短暂展示上一轮结果。
 */
export function project_active_turn_file_diff(
  runtime?: DesktopChatRuntime,
  file_diff?: DesktopTurnFileDiffSummary,
): DesktopTurnFileDiffSummary | undefined {
  return runtime?.turn_id && runtime.turn_id === file_diff?.turn_id ? file_diff : undefined;
}

/**
 * 从 canonical runtime 表重建每个 Agent 的行状态。
 *
 * 一个 Agent 可以有多个 Session 同时活跃，聚合时取最需要用户注意的那个。
 */
export function collect_agent_chat_status(
  runtimes: Record<string, DesktopChatRuntime>,
): Record<string, ChatLiveStatus> {
  const status_by_agent: Record<string, ChatLiveStatus> = {};
  for (const runtime of Object.values(runtimes)) {
    const live = resolve_chat_session_live_status(runtime);
    if (live && is_more_urgent(live, status_by_agent[runtime.agent_id])) status_by_agent[runtime.agent_id] = live;
  }
  return status_by_agent;
}

/**
 * 根据一个 Session 的下一运行态更新 Agent 行状态。
 *
 * `runtime` 为空表示删除该 Session；投影直接读取 runtime 的 `agent_id`，不解析由上层约定的
 * 组合键。状态没有变化的 Agent 不产生新条目，整体无变化时保留原引用。
 */
export function project_agent_chat_status(
  current: Record<string, ChatLiveStatus>,
  runtimes: Record<string, DesktopChatRuntime>,
  session_key: string,
  runtime?: DesktopChatRuntime,
): Record<string, ChatLiveStatus> {
  const affected_agent_ids = new Set<string>();
  const previous_runtime = runtimes[session_key];
  if (previous_runtime) affected_agent_ids.add(previous_runtime.agent_id);
  if (runtime) affected_agent_ids.add(runtime.agent_id);

  let next = current;
  for (const agent_id of affected_agent_ids) {
    const live = highest_live_status(runtimes, session_key, agent_id, runtime);
    if (current[agent_id] === live) continue;
    if (next === current) next = { ...current };
    if (live) next[agent_id] = live; else delete next[agent_id];
  }
  return next;
}

/** 更新指定 Session 后，一个 Agent 在剩余 runtime 中的最高实时状态。 */
function highest_live_status(
  runtimes: Record<string, DesktopChatRuntime>,
  session_key: string,
  agent_id: string,
  runtime: DesktopChatRuntime | undefined,
): ChatLiveStatus | undefined {
  let highest: ChatLiveStatus | undefined;
  const consider = (candidate: DesktopChatRuntime | undefined) => {
    if (candidate?.agent_id !== agent_id) return;
    const live = resolve_chat_session_live_status(candidate);
    if (live && is_more_urgent(live, highest)) highest = live;
  };
  consider(runtime);
  for (const [key, current_runtime] of Object.entries(runtimes)) {
    if (key !== session_key) consider(current_runtime);
  }
  return highest;
}

/**
 * 比较两个实时状态的展示优先级。
 *
 * 只有两个取值，且「等待用户输入」永远比「正在推进」更需要被看到，因此不需要排名表。
 */
function is_more_urgent(candidate: ChatLiveStatus, current?: ChatLiveStatus): boolean {
  return !current || candidate === "action_required";
}
