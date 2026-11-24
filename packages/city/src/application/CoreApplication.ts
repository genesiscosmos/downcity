/** City 公共应用模块；读取经过裁剪的事实，修改调用 canonical Session 服务。 */
import { z } from "zod";
import type { CityRuntimeAccess } from "../city/types/CityRuntimeAccess.js";
import type { ApplicationCall, ApplicationModule } from "./types/Application.js";

const empty = z.object({}).strict();
const session_ref = z.object({ agent_id: z.string(), session_id: z.string(), type: z.string() }).strict();
const rename_input = session_ref.extend({ title: z.string().trim().min(1).max(500) }).strict();
const summary = z.object({ id: z.string(), type: z.string(), kind: z.string(), title: z.string().optional(), workspace_id: z.string().optional(), created_at: z.number().optional(), updated_at: z.number().optional(), executing: z.boolean().optional() });

/** 身份只从可信上下文取值，且每次桥接都检查活 Agent/Session。 */
export function create_core_application(access: CityRuntimeAccess, city_id: string): ApplicationModule[] {
  const assert_caller = (_input: unknown, call: ApplicationCall): void => {
    const { context } = call;
    if (!context.session || !access.get_agent(context.agent.id)?.sessions.peek(context.session.id, context.session.type)) throw new Error("host_unavailable: live Agent Session required");
  };
  const assert_session = (input: unknown, call: ApplicationCall): void => {
    assert_caller(input, call);
    const target = input as z.infer<typeof session_ref>;
    // 第一版不把派生关系当授权；只开放同一 Agent 的公开非秘密会话元数据与标题。
    if (target.agent_id !== call.context.agent.id) throw new Error("permission_denied: target Agent is outside caller scope");
  };
  return [
    { namespace: "context", exports: [{ symbol: "context.current", description: "Current trusted caller identity, host time and Workspace. Contains no environment values.", input: empty,
      output: z.object({ city_id: z.string(), agent_id: z.string(), session_ref, workspace_id: z.string().nullable(), turn_id: z.string().nullable(), tool_call_id: z.string().nullable(), now: z.string() }), effect: "read", authorize: assert_caller,
      invoke: (_input, { context }) => ({ city_id, agent_id: context.agent.id, session_ref: { agent_id: context.agent.id, session_id: context.session!.id, type: context.session!.type }, workspace_id: context.workspace?.id ?? null, turn_id: context.turn?.id ?? null, tool_call_id: context.call.tool_call_id ?? null, now: new Date().toISOString() }) }] },
    { namespace: "sessions", exports: [
      { symbol: "sessions.get", description: "Read a same-Agent Session's public metadata without restoring an executor. Includes its archived state and excludes message text, configuration and credentials.", input: session_ref, output: summary.extend({ archived: z.boolean() }), effect: "read", authorize: assert_session,
        invoke: async (input) => {
          const target = session_ref.parse(input);
          const view = await access.get_agent(target.agent_id)!.sessions.read(target.session_id, target.type);
          return { ...summary.parse({ ...view.metadata, id: view.session_id }), archived: view.archived };
        } },

      { symbol: "sessions.list", description: "Page through the calling Agent's non-secret Session summaries. Pass next_cursor as cursor; each page is a live directory read.",
        input: z.object({ type: z.string().default("work"), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }).strict(),
        output: z.object({ items: z.array(summary), total: z.number(), next_cursor: z.string().optional(), has_more: z.boolean() }), effect: "read", authorize: assert_caller,
        invoke: async (input, call) => await access.get_agent(call.context.agent.id)!.sessions.list(input as never) },
      { symbol: "sessions.rename", description: "Persist a Session title through canonical Session.rename and emit existing mutation events. Requires per-call approval. A timeout may follow persistence; query the title before retrying.",
        input: rename_input, output: z.object({ title: z.string(), session_ref }), effect: "write", authorize: async (input, call) => {
          assert_session(input, call);
          const target = rename_input.parse(input);
          const view = await access.get_agent(target.agent_id)!.sessions.read(target.session_id, target.type);
          if (view.archived) throw new Error("permission_denied: archived Session cannot be renamed");
        },
        invoke: async (input, call) => {
          const target = rename_input.parse(input);
          const session = await access.get_agent(target.agent_id)!.sessions.get(target.session_id, target.type);
          call.signal.throwIfAborted();
          return { title: await session.rename(target.title), session_ref: { agent_id: target.agent_id, session_id: target.session_id, type: target.type } };
        } },
    ] },
    { namespace: "agents", exports: [{ symbol: "agents.current", description: "Public identity of the calling Agent. Does not expose instructions, credentials or configuration internals.", input: empty,
      output: z.object({ id: z.string(), name: z.string(), role: z.array(z.string()).optional(), description: z.string() }), effect: "read", authorize: assert_caller,
      invoke: (_input, call) => ({ id: call.context.agent.id, name: call.context.agent.name, role: call.context.agent.role, description: call.context.agent.description }) }] },
    { namespace: "workspaces", exports: [{ symbol: "workspaces.current", description: "Current actual Workspace reference, or null when no Workspace is attached. Does not infer a Workspace from cwd.", input: empty,
      output: z.object({ id: z.string(), path: z.string() }).nullable(), effect: "read", authorize: assert_caller,
      invoke: (_input, call) => call.context.workspace ? { id: call.context.workspace.id, path: call.context.workspace.path } : null }] },
    { namespace: "environment", exports: [{ symbol: "environment.status", description: "Configured names only for the actual Workspace environment. Plaintext values and secret writes are unavailable.", input: empty,
      output: z.array(z.object({ name: z.string(), configured: z.boolean(), source: z.literal("workspace") })), effect: "read", authorize: assert_caller,
      invoke: (_input, call) => Object.keys(call.context.workspace?.env ?? {}).map(name => ({ name, configured: true, source: "workspace" })) }] },
  ];
}
