/** Desktop Chat 运行态的跨 Session Agent 聚合投影。 */

import type { DesktopChatRuntime } from "@common/types/DesktopApi";

/** 仍占用 Session 执行槽位的运行阶段。 */
const executing_statuses = new Set<DesktopChatRuntime["status"]>(["submitted", "streaming", "waiting_input"]);

/** 从 canonical runtime 表重建正在执行的 Agent 集合。 */
export function collect_executing_agent_ids(runtimes: Record<string, DesktopChatRuntime>): Set<string> {
  const agent_ids = new Set<string>();
  for (const runtime of Object.values(runtimes)) {
    if (executing_statuses.has(runtime.status)) agent_ids.add(runtime.agent_id);
  }
  return agent_ids;
}

/**
 * 根据一个 Session 的下一运行态更新 Agent 执行集合。
 *
 * `runtime` 为空表示删除该 Session；投影直接读取 runtime 的 `agent_id`，
 * 不解析由上层约定的组合键。集合成员没有变化时保留原引用。
 */
export function project_executing_agent_ids(
  current_agent_ids: Set<string>,
  runtimes: Record<string, DesktopChatRuntime>,
  session_key: string,
  runtime?: DesktopChatRuntime,
): Set<string> {
  const affected_agent_ids = new Set<string>();
  const previous_runtime = runtimes[session_key];
  if (previous_runtime) affected_agent_ids.add(previous_runtime.agent_id);
  if (runtime) affected_agent_ids.add(runtime.agent_id);

  let next_agent_ids = current_agent_ids;
  for (const agent_id of affected_agent_ids) {
    const should_execute = has_executing_runtime(runtimes, session_key, agent_id, runtime);
    if (current_agent_ids.has(agent_id) === should_execute) continue;
    if (next_agent_ids === current_agent_ids) next_agent_ids = new Set(current_agent_ids);
    if (should_execute) next_agent_ids.add(agent_id); else next_agent_ids.delete(agent_id);
  }
  return next_agent_ids;
}

/** 判断更新指定 Session 后，一个 Agent 是否仍有任意运行中 Session。 */
function has_executing_runtime(
  runtimes: Record<string, DesktopChatRuntime>,
  session_key: string,
  agent_id: string,
  runtime?: DesktopChatRuntime,
): boolean {
  if (runtime?.agent_id === agent_id && executing_statuses.has(runtime.status)) return true;
  return Object.entries(runtimes).some(([key, current_runtime]) =>
    key !== session_key && current_runtime.agent_id === agent_id && executing_statuses.has(current_runtime.status));
}
