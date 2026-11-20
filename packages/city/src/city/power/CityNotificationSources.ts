/** 通知来源只读解析：按明确引用查询原主体，不维护全量目录或来源状态。 */
import type { Agent, Group } from "@downcity/agent";
import type { PowerNotificationTarget, PowerNotificationResolution } from "@/power/types/PowerNotification.js";

/** 按 Agent 合并最多 100 条小字段查询，单次解析最多两个在途任务；失败只影响对应来源。 */
export async function resolve_notification_targets(
  targets: readonly PowerNotificationTarget[], agents: readonly Agent[], groups: readonly Group[], workspace_ids: readonly string[],
): Promise<PowerNotificationResolution[]> {
  const agent_map = new Map(agents.map(agent => [agent.id, agent]));
  const group_map = new Map(groups.map(group => [group.id, group]));
  const workspaces = new Set(workspace_ids);
  const result: PowerNotificationResolution[] = targets.map(target => ({ target, availability: "unknown" }));
  const agent_batches = new Map<string, number[]>();
  const jobs: (() => Promise<void>)[] = [];
  for (const [index, target] of targets.entries()) {
    if (target.kind === "power") { result[index]!.availability = "available"; continue; }
    if (target.kind === "agent_session") {
      if (!agent_map.has(target.agent_id)) { result[index]!.availability = "removed"; continue; }
      const batch = agent_batches.get(target.agent_id) ?? [];
      batch.push(index); agent_batches.set(target.agent_id, batch);
      continue;
    }
    const group = group_map.get(target.group_id);
    if (!group) { result[index]!.availability = "removed"; continue; }
    jobs.push(async () => {
      try {
        const source = await group.get_session_store().read_session_metadata(target.session_id);
        result[index] = source ? { target, title: source.metadata.title ?? "", availability: source.archived ? "archived"
          : source.metadata.workspace_id && !workspaces.has(source.metadata.workspace_id) ? "unknown" : "available" }
          : { target, availability: "removed" };
      } catch { /* 存储失败不伪装成来源删除，保留 unknown。 */ }
    });
  }
  for (const [agent_id, indices] of agent_batches) {
    for (let offset = 0; offset < indices.length; offset += 100) {
      const batch = indices.slice(offset, offset + 100);
      jobs.push(async () => {
        try {
          const addresses = batch.map(index => {
            const target = targets[index] as Extract<PowerNotificationTarget, { kind: "agent_session" }>;
            return { type: target.type, session_id: target.session_id };
          });
          const records = await agent_map.get(agent_id)!.sessions.read_metadata(addresses);
          for (const [position, index] of batch.entries()) {
            const target = targets[index]!;
            const source = records[position];
            if (target.kind !== "agent_session") continue;
            result[index] = source ? { target,
              title: source.metadata.title ?? "", availability: source.archived ? "archived"
                : source.metadata.workspace_id && !workspaces.has(source.metadata.workspace_id) ? "unknown" : "available" }
              : { target, availability: "removed" };
          }
        } catch { /* 单批读取失败只影响这些引用，其他主体继续解析。 */ }
      });
    }
  }
  let next_job = 0;
  const worker = async () => { for (;;) { const job = jobs[next_job++]; if (!job) return; await job(); } };
  await Promise.all([worker(), worker()]);
  return result;
}
