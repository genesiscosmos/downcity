/**
 * Power 后台 Session 宿主端口。
 * 统一负责可信配置选择、创建幂等、持久化完成读取和有界来源分页，不认识 Memory Job 内容。
 */
import { normalize_session_origin } from "@downcity/type";
import type { Agent } from "@downcity/agent";
import type { CityPowerRuntimeOptions } from "@/city/types/CityPowerRuntime.js";
import type { PowerHostSystem } from "@/power/types/PowerHost.js";
import type { CityExecutionProfiles } from "./CityExecutionProfiles.js";

/** 创建和读取端口的明确子集；其余交互端口由既有 Runtime 持有。 */
export type CityPowerSessionHost = Pick<PowerHostSystem,
  "register_execution_profile" | "create_agent_session" | "read_agent_session" | "read_agent_session_messages" | "stop_agent_session">;

/** 从 City 事实源读取 Agent，不接受无主 Session。 */
function require_agent(access: CityPowerRuntimeOptions["runtime_access"], agent_id: string): Agent {
  const agent = access.get_agent(agent_id);
  if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
  return agent;
}

/** 为单个 Power 建立宿主端口；所有权来自宿主闭包。 */
export function create_power_session_host(power_id: string, access: CityPowerRuntimeOptions["runtime_access"], profiles: CityExecutionProfiles): CityPowerSessionHost {
  return {
    register_execution_profile: (profile) => profiles.register(power_id, profile, access.list_agents()),
    create_agent_session: async (input) => {
      const agent = require_agent(access, input.agent_id);
      profiles.attach_agent(agent);
      const origin = normalize_session_origin(input.origin as import("@downcity/type").SessionOrigin);
      if (input.execution_profile_id) {
        if (input.inherit_workspace) throw new Error("execution_profile_immutable: default Workspace inheritance is forbidden");
        if (input.execution_profile_version === undefined) throw new Error("execution_profile_version_required");
        profiles.assert_owner(power_id, input.execution_profile_id, input.execution_profile_version);
        if (input.workspace_id) access.require_workspace(input.agent_id, input.workspace_id);
        const session = await agent.sessions.create_execution_session({
          origin, workspace_id: input.workspace_id,
          execution_profile_id: input.execution_profile_id,
          execution_profile_version: input.execution_profile_version,
          model_id: input.model_id, creation_key: input.creation_key,
        });
        return { session_id: session.id };
      }
      if (input.execution_profile_version !== undefined || input.model_id || input.creation_key) throw new Error("execution_profile_required: execution options require a registered profile");
      const workspace = input.workspace_id ? await access.enter_workspace(input.agent_id, input.workspace_id) : undefined;
      const session = await agent.sessions.create({ workspace, origin, inherit_workspace: input.inherit_workspace === true });
      return { session_id: session.id };
    },
    stop_agent_session: async (input) => {
      const agent = require_agent(access, input.agent_id);
      await assert_power_session_owner(power_id, agent, profiles, input.session_id, input.category);
      await agent.sessions.runtime(input.session_id, input.category).stop(input.turn_id);
    },
    read_agent_session: async (input) => {
      const agent = require_agent(access, input.agent_id);
      profiles.attach_agent(agent);
      const storage = await agent.sessions.read_session_storage(input.session_id, input.category);
      const metadata = await storage.read_metadata();
      const state = await agent.sessions.read_execution_state(input.session_id, input.category, input);
      return { session_id: input.session_id, executing: agent.sessions.runtime(input.session_id, input.category).is_executing(),
        ...(metadata.execution_profile ? { execution_profile: metadata.execution_profile } : {}), ...state };
    },
    read_agent_session_messages: async (input) => {
      const agent = require_agent(access, input.agent_id);
      profiles.attach_agent(agent);
      const limit = bounded_integer(input.limit, 50, 100, "limit");
      const max_bytes = bounded_integer(input.max_bytes, 256 * 1024, 1024 * 1024, "max_bytes");
      for (const boundary of [input.before_sequence, input.after_sequence, input.through_sequence]) {
        if (boundary !== undefined && (!Number.isSafeInteger(boundary) || boundary < 0)) throw new Error("session_message_boundary_invalid");
      }
      const before_sequence = Math.min(input.before_sequence ?? Infinity,
        input.through_sequence === undefined ? Infinity : input.through_sequence + 1);
      const storage = await agent.sessions.read_session_storage(input.session_id, input.category);
      const page = await storage.list_message_page({
        ...(Number.isFinite(before_sequence) ? { before_sequence } : {}), limit: limit + 1, include_internal: false,
      });
      const candidates = page.filter((message) => message.sequence > (input.after_sequence ?? 0));
      const messages: typeof candidates = [];
      let bytes = 0;
      for (const message of [...candidates].reverse()) {
        const message_bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
        if (!messages.length && message_bytes > max_bytes) throw new Error(`session_message_budget_exceeded: ${message.message_id}`);
        if (messages.length >= limit || bytes + message_bytes > max_bytes) break;
        messages.unshift(message);
        bytes += message_bytes;
      }
      return { messages, bytes,
        ...(candidates.length > messages.length && messages[0] ? { next_before_sequence: messages[0].sequence } : {}),
      };
    },
  };
}

/** 参数越界直接报错，避免静默扩大来源或输出预算。 */
function bounded_integer(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`session_message_${name}_invalid`);
  return result;
}

/** 在执行前校验当前 Power 确实拥有专用配置；读取其他来源不授予执行权。 */
export async function assert_power_session_owner(power_id: string, agent: Agent, profiles: CityExecutionProfiles, session_id: string, category: string): Promise<void> {
  profiles.attach_agent(agent);
  const storage = await agent.sessions.read_session_storage(session_id, category);
  const reference = (await storage.read_metadata()).execution_profile;
  if (reference) profiles.assert_owner(power_id, reference.id, reference.version);
}
