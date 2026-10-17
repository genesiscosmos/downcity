/** User / Agent Profile 宿主入口；同一协议定位、读取、版本化编辑和删除文档。 */
import { z } from "zod";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProfile } from "@/memory/runtime/MemoryProfile.js";
import type { ProfileScope } from "@/memory/types/Profile.js";

/** 注册范围统一的 Profile actions；用户资料归 City，Profile 正文归 Memory。 */
export function register_profile_host_actions(context: PowerLifecycleContext, profile: MemoryProfile): void {
  const scope_schema = z.discriminatedUnion("target", [
    z.object({ target: z.literal("user") }),
    z.object({ target: z.literal("agent"), agent_id: z.string().min(1) }),
  ]);
  const assert_scope = async (scope: ProfileScope): Promise<void> => {
    if (scope.target === "agent" && !(await context.system.list_agents()).some((agent) => agent.agent_id === scope.agent_id)) throw new Error("Unknown Profile Agent");
  };
  context.power.action({ id: "memory.profile_read", run: async (input) => {
    const scope = scope_schema.parse(input);
    await assert_scope(scope);
    return await profile.read(scope);
  } });
  context.power.action({ id: "memory.profile_status", run: async (input) => {
    const scope = scope_schema.parse(input);
    await assert_scope(scope);
    return await profile.status(scope);
  } });
  context.power.action({ id: "memory.profile_edit", run: async (input) => {
    const scope = scope_schema.parse(input);
    const { version, edits } = z.object({ version: z.string().min(1), edits: z.array(z.object({ old_text: z.string().min(1), new_text: z.string() })).min(1).max(32) }).parse(input);
    await assert_scope(scope);
    return await profile.edit(scope, version, edits);
  } });
  context.power.action({ id: "memory.profile_delete", run: async (input) => {
    const scope = scope_schema.parse(input);
    const { version } = z.object({ version: z.string().min(1) }).parse(input);
    await assert_scope(scope);
    return await profile.delete(scope, version);
  } });
}
