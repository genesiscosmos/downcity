/** Power/CLI 共用的公开 Memory 动作；所有内容输入直接使用唯一严格 schema。 */
import { z } from "zod";
import { create_action } from "@downcity/city/power";
import type { PowerActions, PowerContext, PowerJsonObject, PowerLifecycleContext, PowerJsonValue } from "@downcity/city/power";
import type { Command } from "commander";
import type { MemoryProvider } from "../types/MemoryProtocol.js";
import type { MemoryService } from "./MemoryService.js";
import { MemoryRecords } from "./MemoryRecords.js";
import { resolve_memory_access } from "../runtime/AccessResolver.js";
import { memory_remember_schema, memory_update_schema, memory_forget_schema, memory_list_schema, memory_read_schema,
  memory_search_schema, memory_digest_schema, memory_revise_schema, memory_optimize_schema } from "../runtime/MemorySchema.js";

/** 所有 CLI 参数是同一 payload 的字段，没有另一套默认格式。 */
function configure_command(command: Command, fields: readonly string[]): void {
  for (const field of fields) command.option(`--${field.replaceAll("_", "-")} <value>`, field);
}
/** Commander 使用第三方 camelCase 属性，协议边界转换为项目 snake_case。 */
function command_payload(opts: Record<string, unknown>, fields: readonly string[]) {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const key = field.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
    const value = opts[key];
    if (value === undefined) continue;
    payload[field] = ["limit", "offset", "max_results", "max_messages", "from_line", "line_count", "min_score"].includes(field) ? Number(value)
      : field === "source_refs" ? JSON.parse(String(value)) : value;
  }
  return payload;
}
/** 创建唯一公开动作面，调用后始终区分业务失败和已提交结果。 */
export function create_memory_actions(get_provider: () => MemoryProvider, get_service: () => MemoryService, get_host: () => PowerLifecycleContext): PowerActions {
  const run = async (operation: () => Promise<unknown>) => {
    try { return { success: true as const, data: await operation() as PowerJsonValue }; }
    catch (error) { return { success: false as const, error: error instanceof Error ? error.message : String(error),
      ...(error && typeof error === "object" && "code" in error ? { data: { code: String(error.code), ...( "current_version" in error ? { current_version: String(error.current_version ?? "") } : {}) } } : {}) }; }
  };
  const define = (schema: z.ZodType, description: string, access: "read" | "write", fields: readonly string[], operation: (context: PowerContext, input: unknown) => Promise<unknown>) => create_action({
    description, access, returns: access === "write" ? "fixed commit receipt or accepted Job; queued is not committed" : "authorized records and current versions",
    input_schema: { zod: schema, json_schema: z.toJSONSchema(schema) as PowerJsonObject },
    command: { description, configure: (command: Command) => configure_command(command, fields), map_input: ({ opts }) => command_payload(opts, fields) as PowerJsonValue },
    execute: async ({ context, input }) => run(async () => operation(context, schema.parse(input))),
  });
  const jobs_schema = z.object({ limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().nonnegative().optional() }).strict();
  const job_id_schema = z.object({ job_id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
  return {
    status: define(z.object({}).strict(), "Inspect the Memory provider and capabilities without reading records.", "read", [], async () => get_provider().inspect()),
    remember: define(memory_remember_schema, "Create one Agreement (no title) or Knowledge (title required). scope is user, agent or workspace; workspace supports Knowledge only. Agreement requires traceable user evidence. Never change scope after a failed write.", "write", ["scope", "kind", "title", "content", "source_refs", "request_id"], async (context, raw) =>
      new MemoryRecords(get_provider(), get_host()).remember(context, resolve_memory_access(context), memory_remember_schema.parse(raw))),
    update: define(memory_update_schema, "Replace one record's complete content using the version actually read. Knowledge requires title; Agreement forbids it. Scope and kind cannot change.", "write", ["memory_id", "expected_version", "content", "title", "source_refs", "request_id"], async (context, raw) =>
      new MemoryRecords(get_provider(), get_host()).update(context, resolve_memory_access(context), memory_update_schema.parse(raw))),
    forget: define(memory_forget_schema, "Delete or invalidate a record using its read version. A tombstone receipt contains no deleted body.", "write", ["memory_id", "expected_version", "state", "source_refs", "request_id"], async (context, raw) =>
      new MemoryRecords(get_provider(), get_host()).forget(context, resolve_memory_access(context), memory_forget_schema.parse(raw))),
    read: define(memory_read_schema, "Read an exact active record, version and host-bound sources. Body ranges do not include the separate Knowledge title.", "read", ["memory_id", "from_line", "line_count"], async (context, raw) =>
      get_provider().read({ ...memory_read_schema.parse(raw), access: resolve_memory_access(context) })),
    list: define(memory_list_schema, "List active authorized records by scope and kind.", "read", ["scope", "kind", "limit", "offset"], async (context, raw) =>
      get_provider().list({ ...memory_list_schema.parse(raw), access: resolve_memory_access(context) })),
    search: define(memory_search_schema, "Search record title and body within authorized scopes. Citations bind body lines and version.", "read", ["query", "scope", "kind", "max_results", "min_score"], async (context, raw) =>
      get_provider().recall({ ...memory_search_schema.parse(raw), access: resolve_memory_access(context) })),
    digest: define(memory_digest_schema, "Extract one selected kind from a bounded canonical Session window into one scope. Accepted Job is not saved memory.", "write", ["session_id", "type", "scope", "kind", "max_messages"], async (context, raw) =>
      get_service().digest(context, resolve_memory_access(context), memory_digest_schema.parse(raw))),
    revise: define(memory_revise_schema, "Request semantic revision of one record and its read version. Job inherits scope and kind.", "write", ["memory_id", "expected_version", "instruction", "evidence", "source_refs"], async (context, raw) =>
      get_service().revise(context, resolve_memory_access(context), memory_revise_schema.parse(raw))),
    optimize: define(memory_optimize_schema, "Explicitly consolidate one scope and kind while preserving still-applicable agreements, conditions and sources.", "write", ["scope", "kind"], async (context, raw) =>
      get_service().optimize(context, resolve_memory_access(context), memory_optimize_schema.parse(raw))),
    jobs: define(jobs_schema, "List jobs in the current Agent and Workspace, without original source text.", "read", ["limit", "offset"], async (context, raw) => {
      const input = jobs_schema.parse(raw); return get_service().list_jobs(resolve_memory_access(context), input.limit, input.offset);
    }),
    job_status: define(job_id_schema, "Read actual execution status; only a durable receipt supports succeeded.", "read", ["job_id"], async (context, raw) =>
      get_service().job_status(resolve_memory_access(context), job_id_schema.parse(raw).job_id)),
    job_detail: define(job_id_schema, "Read fixed before/after and original captured evidence. Staged changes are not saved.", "read", ["job_id"], async (context, raw) =>
      get_service().job_detail(resolve_memory_access(context), job_id_schema.parse(raw).job_id)),
    retry: define(job_id_schema, "Retry a failed job with its original scope, sources, model and authorization binding.", "write", ["job_id"], async (context, raw) =>
      get_service().retry(resolve_memory_access(context), job_id_schema.parse(raw).job_id, context)),
  };
}
