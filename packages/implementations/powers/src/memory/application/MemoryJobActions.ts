/** Memory Job 的公开状态与人工重试入口，不暴露处理来源正文。 */
import { z } from "zod";
import { create_action } from "@downcity/city/power";
import type { PowerActions, PowerContext, PowerJsonValue } from "@downcity/city/power";
import { resolve_memory_access } from "../runtime/AccessResolver.js";
import type { MemoryService } from "./MemoryService.js";
import type { MemoryProfile } from "../runtime/MemoryProfile.js";

/** 创建延迟解析业务服务的动作，避免初始化前访问依赖。 */
export function create_memory_job_actions(get_service: () => MemoryService, get_profile: () => MemoryProfile): PowerActions {
  /** 错误始终保留失败语义，不能声称请求已完成。 */
  const run = async (context: PowerContext, action: (service: MemoryService) => Promise<unknown>) => {
    try { return { success: true as const, data: await action(get_service()) as PowerJsonValue }; }
    catch (error) { return { success: false as const, error: error instanceof Error ? error.message : String(error) }; }
  };
  const id_schema = z.object({ job_id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
  return {
    optimize: create_action({
      description: "Request evidence-preserving consolidation of the current User or Agent core Profile in a dedicated Memory Session.",
      access: "write", returns: "job_id, status; queued is not saved",
      input_schema: { zod: z.object({ target: z.enum(["user", "agent"]) }).strict(),
        json_schema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: { type: "string", enum: ["user", "agent"] } } } },
      execute: async ({ context, input }) => run(context, async (service) => {
        const { target } = z.object({ target: z.enum(["user", "agent"]) }).strict().parse(input);
        const profile = await get_profile().read(target === "user" ? { target } : { target, agent_id: context.agent.id });
        return service.optimize_profile(context, await resolve_memory_access(context), target, profile);
      }),
    }),
    jobs: create_action({
      description: "List memory processing jobs in the current Agent and Workspace. Does not return source content.",
      access: "read", returns: "items, total",
      input_schema: { zod: z.object({ limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() }).strict(),
        json_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 } } } },
      execute: async ({ context, input }) => run(context, async (service) => {
        const body = z.object({ limit: z.number().optional(), offset: z.number().optional() }).parse(input);
        return service.list_jobs(await resolve_memory_access(context), body.limit, body.offset);
      }),
    }),
    job_status: create_action({
      description: "Read the real status of an accepted memory processing request. Only succeeded means changes were committed.",
      access: "read", returns: "job_id, status, session_id?, memory_ids?, detail?",
      input_schema: { zod: id_schema, json_schema: { type: "object", additionalProperties: false, required: ["job_id"], properties: { job_id: { type: "string" } } } },
      execute: async ({ context, input }) => run(context, async (service) => service.job_status(await resolve_memory_access(context), id_schema.parse(input).job_id)),
    }),
    retry: create_action({
      description: "Retry a failed memory job using its original scope and sources. Does not alter business Task state.",
      access: "write", returns: "job_id, status",
      input_schema: { zod: id_schema, json_schema: { type: "object", additionalProperties: false, required: ["job_id"], properties: { job_id: { type: "string" } } } },
      execute: async ({ context, input }) => run(context, async (service) => service.retry(await resolve_memory_access(context), id_schema.parse(input).job_id)),
    }),
  };
}
