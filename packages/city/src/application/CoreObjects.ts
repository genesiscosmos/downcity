/** City 当前上下文与公开集合对象；每个执行绑定真实 caller，领域对象不离开宿主。 */
import { z } from "zod";
import type { CityRuntimeAccess } from "../city/types/CityRuntimeAccess.js";
import type { ApplicationCall, ApplicationObject } from "./types/Application.js";

const empty = z.object({}).strict();
const session_ref = z.object({ agent_id: z.string(), session_id: z.string(), type: z.string() }).strict();
const summary = z.object({ id: z.string(), type: z.string(), kind: z.string(), title: z.string().optional(), workspace_id: z.string().optional(), created_at: z.number().optional(), updated_at: z.number().optional(), executing: z.boolean().optional() });
const identity = z.object({ id: z.string(), name: z.string(), role: z.array(z.string()).optional(), description: z.string() });
const workspace = z.object({ id: z.string(), path: z.string() });
const title_input = z.object({ title: z.string().trim().min(1).max(500) }).strict();
const session_contract = z.object({
  get: z.function({ input: [empty], output: summary.extend({ archived: z.boolean() }) }).describe("Read this Session's public metadata without restoring an executor."),
  rename: z.function({ input: [title_input], output: z.object({ title: z.string() }) }).describe("Persist this Session's title and emit canonical mutation events. Archived Sessions cannot be renamed."),
});

/** Caller 活性与宿主资源门禁对每个方法重新执行。 */
export function create_core_objects(access: CityRuntimeAccess, city_id: string, assert_resource_access?: (agent_id: string, workspace_id: string) => void): ApplicationObject[] {
  const authorize = (call: ApplicationCall): void => {
    const { context } = call;
    if (!context.session || !access.get_agent(context.agent.id)?.sessions.peek(context.session.id, context.session.type)) throw new Error("host_unavailable: live Agent Session required");
    if (context.workspace) assert_resource_access?.(context.agent.id, context.workspace.id);
  };
  const bind_session = (target: z.infer<typeof session_ref>, call: ApplicationCall) => {
    const require_target = () => {
      authorize(call);
      if (target.agent_id !== call.context.agent.id) throw new Error("permission_denied: target Session is outside caller scope");
      const agent = access.get_agent(target.agent_id);
      if (!agent) throw new Error("host_unavailable: target Agent is unavailable");
      return agent.sessions;
    };
    return {
      get: async () => {
        const view = await require_target().read(target.session_id, target.type);
        return { ...summary.parse({ ...view.metadata, id: view.session_id }), archived: view.archived };
      },
      rename: async ({ title }: z.infer<typeof title_input>) => {
        const sessions = require_target();
        const view = await sessions.read(target.session_id, target.type);
        if (view.archived) throw new Error("permission_denied: archived Session cannot be renamed");
        call.signal.throwIfAborted();
        const session = await sessions.get(target.session_id, target.type);
        call.signal.throwIfAborted();
        return { title: await session.rename(title) };
      },
    };
  };
  const current_ref = (call: ApplicationCall) => ({ agent_id: call.context.agent.id, session_id: call.context.session!.id, type: call.context.session!.type });
  return [
    { name: "context", contract: z.object({ current: z.function({ input: [empty], output: z.object({ city_id: z.string(), agent_id: z.string(), session_ref, workspace_id: z.string().nullable(), turn_id: z.string().nullable(), tool_call_id: z.string().nullable(), now: z.string() }) }).describe("Current trusted caller identity and host time. No environment values.") }), authorize,
      bind: call => ({ current: () => ({ city_id, agent_id: call.context.agent.id, session_ref: current_ref(call), workspace_id: call.context.workspace?.id ?? null, turn_id: call.context.turn?.id ?? null, tool_call_id: call.context.call.tool_call_id ?? null, now: new Date().toISOString() }) }) },
    { name: "agent", contract: z.object({ get: z.function({ input: [empty], output: identity }).describe("Current live Agent identity.") }), authorize,
      bind: call => ({ get: () => { const agent = access.get_agent(call.context.agent.id)!; return { id: agent.id, name: agent.name, role: agent.role, description: agent.description }; } }) },
    { name: "session", contract: session_contract, authorize, bind: call => bind_session(current_ref(call), call) },
    { name: "sessions", contract: z.object({
      get: z.function({ input: [session_ref], output: session_contract }).describe("Bind a same-Agent Session object. Its methods retain the target reference."),
      list: z.function({ input: [z.object({ type: z.string().default("work"), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }).strict()], output: z.object({ items: z.array(summary), total: z.number(), next_cursor: z.string().optional(), has_more: z.boolean() }) }).describe("Page through the calling Agent's public Session metadata."),
    }), authorize, bind: call => ({ get: (target: z.infer<typeof session_ref>) => { if (target.agent_id !== call.context.agent.id) throw new Error("permission_denied: target Session is outside caller scope"); return bind_session(target, call); }, list: async (input: object) => await access.get_agent(call.context.agent.id)!.sessions.list(input) }) },
    { name: "workspace", contract: z.object({ get: z.function({ input: [empty], output: workspace.nullable() }).describe("Current actual Workspace reference, or null.") }), authorize,
      bind: call => ({ get: () => call.context.workspace ? { id: call.context.workspace.id, path: call.context.workspace.path } : null }) },
    { name: "workspaces", contract: z.object({ list: z.function({ input: [empty], output: z.array(workspace) }).describe("Current City's public Workspace directory.") }), authorize,
      bind: () => ({ list: () => access.list_workspaces().map(item => ({ id: item.id, path: item.path })) }) },
    { name: "environment", contract: z.object({ status: z.function({ input: [empty], output: z.array(z.object({ name: z.string(), configured: z.boolean(), source: z.literal("workspace") })) }).describe("Configured environment names only. Secret values and writes are unavailable.") }), authorize,
      bind: call => ({ status: () => Object.keys(call.context.workspace?.env ?? {}).map(name => ({ name, configured: true, source: "workspace" })) }) },
  ];
}
