/**
 * Agent Power 的跨 Agent 委派动作。
 *
 * 只允许向另一个 Agent 提交独立任务，不授予读取、继续、停止或归档其会话的权限。
 * 目标 Agent 持有工作会话；结果通过既有持久化委派协议回传实际调用方。
 */
import { z } from "zod";
import type { PowerAction, PowerJsonObject, PowerJsonValue } from "@/power/index.js";
import type { CityGroupPowerOptions } from "../CityGroupPower.js";
import { session_start_input } from "../session/SessionSchemas.js";
import { session_delegation_caller } from "../session/SessionCaller.js";

/** 委派输入独立声明目标身份；Session 动作本身不接受该字段。 */
const delegate_input = session_start_input.extend({
  agent_id: z.string().trim().min(1).describe("Another agent's ID from agent.list. The target owns the resulting work session; this does not grant access to its sessions."),
});

/** 创建跨 Agent 的单次委派入口，复用目标 Agent 的工作服务。 */
export function create_agent_delegate_action(options: CityGroupPowerOptions): PowerAction {
  return {
    description: "Delegate a self-contained project task to another agent from agent.list. Requires agent_id, workspace_id and query; optional model_id and title. Returns a delegation receipt immediately; completion returns automatically. Does not grant access to the target agent's sessions. Do not poll.",
    returns: "agent_id, delegation_id, status=delegated; completion returns automatically to the calling conversation",
    access: "write",
    input_schema: { zod: delegate_input, json_schema: z.toJSONSchema(delegate_input) as PowerJsonObject },
    execute: async ({ input, context }) => {
      const caller = session_delegation_caller(context);
      const { agent_id, ...work_input } = delegate_input.parse(input ?? {});
      if (agent_id === context.agent.id) throw new Error("Use session.start for the current agent's own work");
      const target = options.access.list_agents().find((agent) => agent.id === agent_id);
      if (!target) throw new Error(`Agent not found in City: ${agent_id}`);
      const receipt = await target.get_session_work().spawn(work_input, caller);
      return { success: true, data: { agent_id, delegation_id: receipt.delegation_id, status: "delegated" } as PowerJsonValue };
    },
  };
}
