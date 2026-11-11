/** Memory 后台整理的宿主管理入口；只接受明确范围、开关与用户直接填写的纠错。 */
import { z } from "zod";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import { MemoryDreaming } from "../application/MemoryDreaming.js";

const scope_schema = z.object({
  agent_id: z.string().min(1), workspace_id: z.string().min(1).optional(),
  target: z.enum(["agent", "current_workspace"]),
});

/** 不注册到普通模型 Action 集合，来源身份和 producer 只能由可信宿主接线提供。 */
export function register_memory_dream_host_actions(host: PowerLifecycleContext, dreaming: MemoryDreaming): void {
  host.power.action({ id: "memory.dream.list", run: async () =>
    await dreaming.list() as unknown as PowerJsonValue });
  host.power.action({ id: "memory.dream.status", run: async (input) =>
    await dreaming.view(scope_schema.parse(input)) as unknown as PowerJsonValue });
  host.power.action({ id: "memory.dream.configure", run: async (input) => {
    const value = scope_schema.extend({ enabled: z.boolean() }).strict().parse(input);
    const { enabled, ...scope } = value;
    return await dreaming.configure(scope, enabled) as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.dream.retry", run: async (input) => {
    const { batch_id, ...scope } = scope_schema.extend({ batch_id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(input);
    return await dreaming.retry(scope, batch_id) as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.dream.correction", run: async (input) => {
    const { event_id, occurred_at, content, workspace_share_allowed, ...scope } = scope_schema.extend({
      event_id: z.uuid(), occurred_at: z.iso.datetime(), content: z.string().trim().min(1).max(24000),
      workspace_share_allowed: z.boolean().default(false),
    }).strict().parse(input);
    await dreaming.receive({ ...scope, event_id, occurred_at, producer: "explicit_user", event_type: "user_correction", workspace_share_allowed,
      source_boundary: `explicit-user-correction:${event_id}:text-range:0:${content.length}`,
      sources: [{ source_id: `user-correction:${event_id}`, agent_id: scope.agent_id, category: "manual", role: "user", text: content }],
    });
    return { received: true, processed: false, committed: false };
  } });
}
