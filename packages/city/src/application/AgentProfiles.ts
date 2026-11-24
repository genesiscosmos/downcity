/** Agent 公开集合与 profile 对象；Desktop、CLI 和脚本复用同一个 revision-safe 资源服务。 */
import { z } from "zod";
import type { AgentResources } from "../local/resources/AgentResources.js";
import type { ApplicationCall, ApplicationObject } from "./types/Application.js";

const empty = z.object({}).strict();
const directory_input = z.object({ query: z.string().optional() }).strict();
const agent_ref = z.object({ agent_id: z.string().min(1) }).strict();
const model_reference = z.union([z.object({ downtown: z.string().min(1), id: z.string().min(1) }).strict(), z.object({ client: z.string().min(1), id: z.string().min(1) }).strict()]);
const profile = z.object({
  agent_id: z.string(), name: z.string(), role: z.array(z.string()).optional(), description: z.string(),
  model: model_reference.nullable(), revision: z.string().nullable(), registered: z.boolean(), runtime_state: z.enum(["loaded", "unloaded", "unknown"]),
  created_at: z.string().nullable(), updated_at: z.string().nullable(),
});
const update_input = z.object({
  if_revision: z.string().min(1), name: z.string().trim().min(1).optional(), role: z.array(z.string()).optional(),
  description: z.string().optional(), instruction: z.string().optional(), model: model_reference.optional(), unset_model: z.boolean().optional(),
}).strict();
const agent_object = z.object({ profile: z.object({
  get: z.function({ input: [empty], output: profile.extend({ instruction: z.string().nullable() }) }).describe("Read this Agent's non-secret profile and instruction, including canonical revision. No environment, tokens or private runtime configuration."),
  update: z.function({ input: [update_input], output: z.object({ agent: profile, changed: z.boolean(), saved_revision: z.string(), applied_revision: z.string().nullable(), effective_scope: z.string(), model_validation: z.string() }) }).describe("Save this Agent's profile using if_revision from profile.get. Uses the same resource service and events as Desktop/CLI. Existing Session snapshots retain their instructions; new Sessions use the saved profile. Conflict requires a fresh read; do not replay blindly."),
}) });

/** 宿主显式授予非秘密 Agent profile 管理；目标必须属于该宿主持有的资源集合。 */
export function create_agent_profiles(
  get_resources: () => Pick<AgentResources, "list" | "get" | "update">,
  authorize: (call: ApplicationCall, target_agent_id?: string) => void | Promise<void>,
): ApplicationObject {
  return { name: "agents", contract: z.object({
    list: z.function({ input: [directory_input], output: z.object({ items: z.array(profile), total: z.number() }) }).describe("Discover this host's Agent profile directory, including other Agents. Only non-secret profile fields are published."),
    get: z.function({ input: [agent_ref], output: agent_object }).describe("Bind an authorized Agent object by stable ID. Use its profile.get() and profile.update({if_revision, ...}) methods."),
  }), authorize: call => authorize(call), bind: call => ({
    list: (input: z.infer<typeof directory_input>) => get_resources().list(input),
    get: async ({ agent_id }: z.infer<typeof agent_ref>) => {
      await authorize(call, agent_id);
      await get_resources().get(agent_id);
      return { profile: {
        get: async () => { await authorize(call, agent_id); call.signal.throwIfAborted(); return (await get_resources().get(agent_id, true)).agent; },
        update: async (input: z.infer<typeof update_input>) => {
          await authorize(call, agent_id);
          call.signal.throwIfAborted();
          return await get_resources().update(agent_id, input);
        },
      } };
    },
  }) };
}
