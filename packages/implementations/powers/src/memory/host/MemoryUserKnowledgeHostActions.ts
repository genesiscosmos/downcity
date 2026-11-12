/** 本地用户知识的可信管理入口：无需 Agent，以结构化 User 身份授权，确定性事务写入。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { LOCAL_USER_ID } from "@downcity/city/local";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryProvider, MemoryRecord } from "../types/Memory.js";
import type { MemoryUserAccessContext } from "../types/MemoryAccess.js";
import type { MemoryChange, MemoryCommitReceipt } from "../types/MemoryChangeSet.js";
import { require_memory_transactions } from "../application/MemoryKnowledge.js";
import { MemoryVersionConflictError } from "../types/MemoryChangeSet.js";

const access: MemoryUserAccessContext = { authority: "local_user", user_id: LOCAL_USER_ID,
  city_memory_available: false, exclude_city: true };
const id_schema = z.object({ memory_id: z.string().min(1) }).strict();
const create_schema = z.object({ content: z.string().trim().min(1).max(24000), request_id: z.uuid() }).strict();
const update_schema = create_schema.extend({ memory_id: z.string().min(1), version: z.string().min(1) }).strict();
const forget_schema = z.object({ memory_id: z.string().min(1), version: z.string().min(1), request_id: z.uuid() }).strict();

/** 归属由记录字段校验，不从 Provider ID 的路径猜测。 */
function assert_user_record(record: MemoryRecord): void {
  if (record.owner.kind !== "user" || record.owner.user_id !== LOCAL_USER_ID
    || record.subject.kind !== "user" || record.subject.user_id !== LOCAL_USER_ID || record.metadata?.applicable_agent_id) {
    throw new Error("Memory is outside local User ownership");
  }
}

/** 只向可信宿主注册，不向普通模型暴露宿主 User 身份的构造参数。 */
export function register_memory_user_knowledge_host_actions(host: PowerLifecycleContext, provider: MemoryProvider): void {
  const read_user = async (memory_id: string) => {
    const result = await provider.read({ access, memory_id });
    if (result.memory) {
      if (result.memory.memory_id !== memory_id) throw new Error("Memory provider returned a different record");
      assert_user_record(result.memory);
    }
    return result;
  };
  /** 已提交请求先核对原始业务指纹，再返回回执；不会把重试基线替换成当前版本。 */
  const commit_user = async (operation: "create" | "update" | "delete", request: { content?: string; request_id: string; memory_id?: string; version?: string }): Promise<MemoryCommitReceipt> => {
    const transactions = require_memory_transactions(provider);
    const commit_id = `host:user:${operation}:${request.request_id}`;
    const fingerprint = createHash("sha256").update(JSON.stringify([operation, request.memory_id, request.version, request.content])).digest("hex");
    const source = { source_id: `host:user:${request.request_id}`, source_type: "manual", role: "request" as const, label: "用户手动管理", locator: `request:${fingerprint}` };
    const change: MemoryChange = { operation, ...(request.memory_id ? { memory_id: request.memory_id } : {}),
      ...(request.version ? { expected_version: request.version } : {}),
      ...(request.content ? { content: request.content } : {}), source_refs: [source],
      ...(operation === "create" ? { allow_recreation: true } : {}) };
    // Provider commit 校验同幂等键的完整请求；重复删除也能返回原回执。
    const previous = await transactions.read_commit_receipt({ access, target: "user", commit_id });
    if (!previous && operation !== "create") {
      const current = await read_user(request.memory_id!);
      if (!current.memory || current.memory.version !== request.version) throw new MemoryVersionConflictError("User knowledge version changed; read before editing");
    }
    return await transactions.commit({ access, target: "user", commit_id, changes: [change] });
  };
  host.power.action({ id: "memory.user_knowledge.list", run: async (input) => {
    const { query = "", limit = 30, offset = 0 } = z.object({ query: z.string().max(8000).optional(),
      limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() }).strict().parse(input ?? {});
    const result = await provider.list({ access, subject_kinds: ["user"], limit: 100, offset: 0 });
    const items = [...result.items];
    for (let start = items.length; start < result.total;) {
      const page = await provider.list({ access, subject_kinds: ["user"], limit: 100, offset: start });
      if (!page.items.length) throw new Error("User knowledge pagination ended before the reported total");
      items.push(...page.items); start += page.items.length;
    }
    const normalized_query = query.trim().toLocaleLowerCase();
    const selected = [] as typeof items;
    for (const item of items) {
      const record = (await read_user(item.memory_id)).memory;
      if (!record) continue;
      if (!normalized_query || record.content.toLocaleLowerCase().includes(normalized_query)) selected.push(item);
    }
    return { items: selected.slice(offset, offset + limit), total: selected.length } as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.user_knowledge.read", run: async (input) => {
    const { memory_id } = id_schema.parse(input);
    return await read_user(memory_id) as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.user_knowledge.create", run: async (input) =>
    await commit_user("create", create_schema.parse(input)) as unknown as PowerJsonValue });
  host.power.action({ id: "memory.user_knowledge.update", run: async (input) =>
    await commit_user("update", update_schema.parse(input)) as unknown as PowerJsonValue });
  host.power.action({ id: "memory.user_knowledge.forget", run: async (input) =>
    await commit_user("delete", forget_schema.parse(input)) as unknown as PowerJsonValue });
}
