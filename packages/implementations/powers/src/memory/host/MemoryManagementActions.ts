/** 已认证宿主管理入口：选择对象后重新核对目录，复用公开 schema 与统一记录提交服务。 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { LOCAL_USER_ID } from "@downcity/city/local";
import type { ModelReference } from "@downcity/type";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider } from "../types/MemoryProtocol.js";
import type { MemoryUserAccessContext } from "../types/MemoryAccess.js";
import { MemoryRecords } from "../application/MemoryRecords.js";
import { management_memory_sources } from "../application/MemorySourceBinding.js";
import { memory_id_schema, memory_remember_schema, memory_update_schema, memory_forget_schema, memory_read_schema, memory_list_schema, memory_search_schema } from "../runtime/MemorySchema.js";

const management_schema = z.object({ scope: z.enum(["user", "agent", "workspace"]),
  agent_id: z.string().min(1).optional(), workspace_id: z.string().min(1).optional() }).strict();
/** 管理参数只用于选择宿主已授权对象，不进入普通模型协议。 */
async function management_access(host: PowerLifecycleContext, raw: unknown): Promise<MemoryUserAccessContext> {
  const input = management_schema.parse(raw);
  const agents = input.scope === "agent" ? await host.system.list_agents() : [];
  const workspaces = input.scope === "workspace" ? await host.system.list_workspaces() : [];
  const id = input.scope === "user" ? LOCAL_USER_ID : input.scope === "agent" ? input.agent_id : input.workspace_id;
  if (!id || (input.scope === "agent" && !agents.some((agent) => agent.agent_id === id))
    || (input.scope === "workspace" && !workspaces.some((workspace) => workspace.workspace_id === id))) throw new Error("Memory management scope unavailable");
  return { authority: "local_user", user_id: LOCAL_USER_ID, city_memory_available: false,
    managed_scope: { type: input.scope, id } };
}
/** 管理包装有且仅有 routing 与 payload，两层都严格校验。 */
const envelope_schema = z.object({ routing: management_schema, payload: z.unknown() }).strict();
/** 仅注册可信宿主 action，不提供可由模型选择的 management 来源类型。 */
export function register_memory_management_actions(host: PowerLifecycleContext, provider: MemoryProvider, execution_agent_id?: string): void {
  const records = new MemoryRecords(provider);
  host.power.action({ id: "memory.config.snapshot", run: async () => ({ knowledge: { status: await provider.inspect() }, processing: { execution_agent_id } }) as unknown as PowerJsonValue });
  host.power.action({ id: "memory.scopes", run: async () => {
    const [agents, workspaces] = await Promise.all([host.system.list_agents(), host.system.list_workspaces()]);
    return { agents: agents.map(({ agent_id, name }) => ({ agent_id, name })), workspaces: workspaces.map(({ workspace_id, name }) => ({ workspace_id, name })) };
  } });
  host.power.action({ id: "memory.agreement_budget", run: async (raw) => {
    const routing = management_schema.parse(raw);
    const access = await management_access(host, routing);
    let total = 0, characters = 0, bytes = 0;
    for (let offset = 0;;) {
      const page = await provider.list({ access, scope: routing.scope, kind: "agreement", limit: 500, offset });
      for (const item of page.items) { characters += Array.from(item.content).length; bytes += Buffer.byteLength(item.content, "utf8"); }
      total = page.total; offset += page.items.length;
      if (offset >= page.total) break;
      if (!page.items.length) throw new Error("Incomplete Agreement budget projection");
    }
    return { total, characters, estimated_tokens: Math.ceil(bytes / 3) };
  } });
  host.power.action({ id: "memory.history", run: async (raw) => {
    const { routing, payload } = envelope_schema.parse(raw);
    const access = await management_access(host, routing);
    const { memory_id } = z.object({ memory_id: memory_id_schema }).strict().parse(payload);
    if (!provider.transactions) throw new Error("Memory transactions unavailable");
    return { records: await provider.transactions.read_history({ access, memory_id }) } as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.recreate", run: async (raw) => {
    const { routing, payload } = envelope_schema.parse(raw);
    const access = await management_access(host, routing);
    const input = z.object({ tombstone_id: memory_id_schema, expected_version: z.string().min(1), record: memory_remember_schema }).strict().parse(payload);
    if (input.record.scope !== routing.scope || !provider.transactions) throw new Error("Management scope mismatch or unavailable transactions");
    const request_id = input.record.request_id ?? randomUUID();
    const sources = management_memory_sources(`recreate:${request_id}`, input);
    const record = input.record;
    return await provider.transactions.commit({ access, scope: routing.scope, commit_id: `recreate:${request_id}`, request_id,
      recreation: { memory_id: input.tombstone_id, expected_version: input.expected_version },
      changes: [record.kind === "agreement" ? { operation: "create", kind: "agreement", content: record.content, sources }
        : { operation: "create", kind: "knowledge", content: record.content, title: record.title, sources }] }) as unknown as PowerJsonValue;
  } });
  for (const action of ["list", "search", "read", "remember", "update", "forget"] as const) host.power.action({
    id: `memory.${action}`, run: async (raw) => {
      const { routing, payload } = envelope_schema.parse(raw);
      const access = await management_access(host, routing);
      const operation_id = randomUUID();
      if (action === "list") {
        const input = memory_list_schema.parse(payload);
        if (input.scope && input.scope !== routing.scope) throw new Error("Management scope mismatch");
        return await provider.list({ ...input, scope: routing.scope, access }) as unknown as PowerJsonValue;
      }
      if (action === "search") {
        const input = memory_search_schema.parse(payload);
        if (input.scope && input.scope !== routing.scope) throw new Error("Management scope mismatch");
        return await provider.recall({ ...input, scope: routing.scope, access }) as unknown as PowerJsonValue;
      }
      if (action === "read") return await provider.read({ ...memory_read_schema.parse(payload), access }) as unknown as PowerJsonValue;
      if (payload && typeof payload === "object" && "source_refs" in payload && Array.isArray(payload.source_refs) && payload.source_refs.length) throw new Error("SOURCE_SESSION_REQUIRED");
      const sources = management_memory_sources(operation_id, payload);
      if (action === "remember") {
        const input = memory_remember_schema.parse(payload);
        if (input.scope !== routing.scope) throw new Error("Management scope mismatch");
        return await records.create_bound(access, input, sources) as unknown as PowerJsonValue;
      }
      if (action === "update") return await records.update_bound(access, memory_update_schema.parse(payload), sources) as unknown as PowerJsonValue;
      return await records.forget_bound(access, memory_forget_schema.parse(payload), sources) as unknown as PowerJsonValue;
    },
  });
}
