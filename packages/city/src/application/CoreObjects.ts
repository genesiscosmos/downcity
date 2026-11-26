/** City 当前上下文与公开集合对象；每个执行绑定真实 caller，领域对象不离开宿主。 */
import { z } from "zod";
import { session_archive_input, session_archive_result, session_list_input, session_metadata_schema, session_page_schema, session_title_input } from "../power/types/PowerSessionManagement.js";
import type { PowerAgentHandle } from "../power/types/PowerContext.js";
import type { ApplicationCall, ApplicationObject } from "./types/Application.js";

const empty = z.object({}).strict();
const session_ref = z.object({ agent_id: z.string(), session_id: z.string(), type: z.string() }).strict();
const summary = session_metadata_schema;
const identity = z.object({ id: z.string(), name: z.string(), role: z.array(z.string()).optional(), description: z.string() });
const workspace = z.object({ id: z.string(), name: z.string(), path: z.string() });
const title_input = session_title_input;
const bound_archive_input = session_archive_input.omit({ session_id: true, type: true });
const session_contract = z.object({
  get: z.function({ input: [empty], output: summary.extend({ archived: z.boolean() }) }).describe("Read this Session's public metadata without restoring an executor."),
  rename: z.function({ input: [title_input], output: z.object({ title: z.string() }) }).describe("Persist this Session's title and emit canonical mutation events. Archived Sessions cannot be renamed."),
  archive: z.function({ input: [bound_archive_input], output: session_archive_result }).describe("Archive this idle Session and all descendant Work Sessions. Busy or queued descendants reject the operation. Preserve recovery identifiers after partial failure."),
});
const session_collection_contract = z.object({
  list: z.function({ input: [session_list_input], output: session_page_schema }).describe("Page through this Agent's active Sessions, optionally filtered by Workspace. Timestamps are milliseconds; retain all filters when continuing a cursor."),
  get: z.function({ input: [session_ref.omit({ agent_id: true })], output: session_contract }).describe("Bind a Session belonging to this Agent. Reading and archiving do not restore an executor."),
});
const agent_contract = z.object({
  get: z.function({ input: [empty], output: identity }).describe("Read this Agent's public identity."),
  sessions: session_collection_contract,
});
const city_contract = z.object({
  get: z.function({ input: [empty], output: z.object({ id: z.string() }) }).describe("Read the current City identity."),
  agents: z.object({
    list: z.function({ input: [empty], output: z.array(identity) }).describe("List the current City's visible Agent identities."),
    get: z.function({ input: [z.object({ agent_id: z.string() }).strict()], output: agent_contract }).describe("Bind a City Agent. Session management retains the calling Agent's scope."),
  }),
  workspaces: z.object({
    list: z.function({ input: [empty], output: z.array(workspace) }).describe("List the current City's Workspaces."),
    get: z.function({ input: [z.object({ workspace_id: z.string() }).strict()], output: workspace }).describe("Read a Workspace from the current City directory."),
  }),
});

/** Caller 活性与宿主资源门禁对每个方法重新执行。 */
export function create_core_objects(assert_resource_access?: (agent_id: string, workspace_id: string) => void): ApplicationObject[] {
  const authorize = (call: ApplicationCall): void => {
    const { context } = call;
    if (!context.session || !context.city.agents.get(context.agent.id)) throw new Error("host_unavailable: live Agent Session required");
    if (context.workspace) assert_resource_access?.(context.agent.id, context.workspace.id);
  };
  const bind_session = (target: z.infer<typeof session_ref>, call: ApplicationCall) => {
    const require_target = () => {
      authorize(call);
      if (target.agent_id !== call.context.agent.id) throw new Error("permission_denied: target Session is outside caller scope");
      const agent = call.context.city.agents.get(target.agent_id);
      if (!agent) throw new Error("host_unavailable: target Agent is unavailable");
      return agent.sessions;
    };
    const read_target = async () => {
      const sessions = require_target();
      const metadata = await sessions.metadata({ session_id: target.session_id, type: target.type });
      if (metadata.workspace_id) assert_resource_access?.(target.agent_id, metadata.workspace_id);
      call.signal.throwIfAborted();
      return { sessions, metadata };
    };
    return {
      get: async () => (await read_target()).metadata,
      rename: async ({ title }: z.infer<typeof title_input>) => {
        const { sessions } = await read_target();
        return await sessions.rename({ session_id: target.session_id, type: target.type, title });
      },
      archive: async (input: z.infer<typeof bound_archive_input>) => {
        const { sessions } = await read_target();
        return await sessions.archive({ ...input, session_id: target.session_id, type: target.type });
      },
    };
  };
  const current_ref = (call: ApplicationCall) => ({ agent_id: call.context.agent.id, session_id: call.context.session!.id, type: call.context.session!.type });
  const describe_agent = (agent: PowerAgentHandle) => ({ id: agent.id, name: agent.name, role: agent.role ? [...agent.role] : undefined, description: agent.description });
  const bind_collection = (agent_id: string, call: ApplicationCall) => ({
    get: (target: { /** 会话永久 UUID。 */ session_id: string; /** 持久化分类。 */ type: string }) => bind_session({ ...target, agent_id }, call),
    list: async (input: z.input<typeof session_list_input>) => {
      if (agent_id !== call.context.agent.id) throw new Error("permission_denied: target Session is outside caller scope");
      const agent = call.context.city.agents.get(agent_id);
      if (!agent) throw new Error("host_unavailable: target Agent is unavailable");
      if (input.workspace_id) assert_resource_access?.(agent_id, input.workspace_id);
      const page = await agent.sessions.list(input);
      for (const item of page.items) if (item.workspace_id) assert_resource_access?.(agent_id, item.workspace_id);
      return page;
    },
  });
  const bind_city = (call: ApplicationCall) => ({
    get: () => ({ id: call.context.city.id }),
    agents: {
      list: () => call.context.city.agents.list().map(describe_agent),
      get: ({ agent_id }: { /** 目标 Agent 标识。 */ agent_id: string }) => {
        const require_agent = () => {
          const agent = call.context.city.agents.get(agent_id);
          if (!agent) throw new Error("host_unavailable: target Agent is unavailable");
          return agent;
        };
        require_agent();
        return { get: () => describe_agent(require_agent()), sessions: bind_collection(agent_id, call) };
      },
    },
    workspaces: {
      list: () => call.context.city.workspaces.list().map(item => workspace.parse(item)),
      get: ({ workspace_id }: { /** 目标 Workspace 标识。 */ workspace_id: string }) => {
        const item = call.context.city.workspaces.get(workspace_id);
        if (!item) throw new Error("host_unavailable: target Workspace is unavailable");
        return workspace.parse(item);
      },
    },
  });
  return [
    { name: "city", contract: city_contract, authorize, bind: bind_city },
    { name: "context", contract: z.object({ current: z.function({ input: [empty], output: z.object({ city_id: z.string(), agent_id: z.string(), session_ref, workspace_id: z.string().nullable(), turn_id: z.string().nullable(), tool_call_id: z.string().nullable(), now: z.string() }) }).describe("Current trusted caller identity and host time. No environment values.") }), authorize,
      bind: call => ({ current: () => ({ city_id: call.context.city.id, agent_id: call.context.agent.id, session_ref: current_ref(call), workspace_id: call.context.workspace?.id ?? null, turn_id: call.context.turn?.id ?? null, tool_call_id: call.context.call.tool_call_id ?? null, now: new Date().toISOString() }) }) },
    { name: "agent", contract: agent_contract, authorize,
      bind: call => ({ get: () => describe_agent(call.context.agent), sessions: bind_collection(call.context.agent.id, call) }) },
    { name: "session", contract: session_contract, authorize, bind: call => bind_session(current_ref(call), call) },
    { name: "workspace", contract: z.object({ get: z.function({ input: [empty], output: workspace.nullable() }).describe("Current actual Workspace reference, or null.") }), authorize,
      bind: call => ({ get: () => call.context.workspace ? workspace.parse(call.context.workspace) : null }) },
    { name: "environment", contract: z.object({ status: z.function({ input: [empty], output: z.array(z.object({ name: z.string(), configured: z.boolean(), source: z.literal("workspace") })) }).describe("Configured environment names only. Secret values and writes are unavailable.") }), authorize,
      bind: call => ({ status: () => Object.keys(call.context.workspace?.env ?? {}).map(name => ({ name, configured: true, source: "workspace" })) }) },
  ];
}
