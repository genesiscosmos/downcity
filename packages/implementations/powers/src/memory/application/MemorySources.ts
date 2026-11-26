/** 将 canonical 消息转换为有界证据，保留角色和消息定位，不读取物理会话路径。 */
import { createHash } from "node:crypto";
import type { PowerContext, PowerJsonObject, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryJobSource } from "../types/MemoryJob.js";
import { assert_memory_text_safe } from "../runtime/MemorySensitiveText.js";
import { capture_memory_source } from "./MemorySourceBinding.js";
import { MEMORY_SESSION_KIND } from "../types/MemorySession.js";

/** 为内容和来源边界生成稳定幂等标识。 */
export function memory_request_hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 从真实会话中读取一段明确有界的原始文本；Memory 处理 Session 不允许再次摄取。 */
export async function read_memory_sources(
  context: PowerContext,
  host: PowerLifecycleContext,
  session_id: string,
  type: string,
  max_messages: number,
): Promise<MemoryJobSource[]> {
  if (!["chat", "work"].includes(type)) throw new Error("Invalid source Session type");
  if (!Number.isInteger(max_messages) || max_messages < 1 || max_messages > 100) throw new Error("max_messages must be between 1 and 100");
  const session = await context.agent.sessions.get(session_id, type);
  if (session.kind === MEMORY_SESSION_KIND) throw new Error("Memory Session history cannot become a memory source");
  if (session.workspace_id && session.workspace_id !== context.workspace?.id) throw new Error("Source Session belongs to another Workspace");
  const page = await host.system.read_agent_session_messages({
    agent_id: context.agent.id, session_id, type, limit: max_messages, max_bytes: 256_000,
  });
  const sources: MemoryJobSource[] = page.messages.flatMap((raw_message) => {
    const message = raw_message as unknown as PowerJsonObject;
    if (message.role !== "user" && message.role !== "agent") return [];
    const meta = message.meta as PowerJsonObject | undefined;
    const actor = meta?.from as PowerJsonObject | undefined;
    const role = message.role === "agent" ? "agent" as const : actor?.kind === "user" ? "user" as const : "request" as const;
    return (Array.isArray(message.parts) ? message.parts : []).flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part) || part.type !== "text" || typeof part.text !== "string" || !part.text.trim()) return [];
      if (typeof part.part_id !== "string" || typeof message.message_id !== "string") throw new Error("Canonical source has no Part identity");
      if (Array.from(part.text).length > 12000) throw new Error("SOURCE_BUDGET_EXCEEDED: select a smaller source window");
      const bound_source = capture_memory_source({ source_type: "session_message", role, excerpt: part.text, locator: {
        agent_id: context.agent.id, session_type: type, session_id, message_id: message.message_id, part_id: part.part_id, field: "text",
        start_offset: 0, end_offset: part.text.length,
      }, note: "One complete text Part in an explicitly selected bounded Session window" }, part.text);
      return [{ source_id: bound_source.source_id, agent_id: context.agent.id, category: type, session_id,
        message_id: message.message_id, role, text: part.text, bound_source }];
    });
  });
  if (!sources.length) throw new Error("Source Session has no readable canonical text messages");
  if (sources.reduce((count, source) => count + source.text.length, 0) > 64_000) throw new Error("Source exceeds 64000 characters; choose a smaller message window");
  for (const source of sources) assert_memory_text_safe(source.text);
  return sources;
}
