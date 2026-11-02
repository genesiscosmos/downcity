/** 将显式输入及 canonical 消息转换为有界证据，保留角色和消息定位，不读取物理会话路径。 */
import { createHash, randomUUID } from "node:crypto";
import type { PowerContext, PowerJsonObject, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryJobSource } from "../types/MemoryJob.js";

/** 为内容和来源边界生成稳定幂等标识。 */
export function memory_request_hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 显式写入请求作为请求证据，不能假称为用户原话。 */
export function explicit_memory_source(context: PowerContext, content: string): MemoryJobSource {
  return {
    source_id: `request:${memory_request_hash([context.agent.id, context.session?.id, context.call?.tool_call_id ?? context.turn?.id ?? randomUUID(), content])}`,
    agent_id: context.agent.id, category: context.session?.origin.category ?? "work",
    session_id: context.session?.id, role: "request", text: content,
  };
}

/** 从真实会话中读取一段明确有界的原始文本；Memory 处理 Session 不允许再次摄取。 */
export async function read_memory_sources(
  context: PowerContext,
  host: PowerLifecycleContext,
  session_id: string,
  category: string,
  max_messages: number,
): Promise<MemoryJobSource[]> {
  if (!["chat", "work"].includes(category)) throw new Error("Invalid source Session category");
  if (!Number.isInteger(max_messages) || max_messages < 1 || max_messages > 100) throw new Error("max_messages must be between 1 and 100");
  const session = await context.agent.sessions.get(session_id, category);
  if (session.origin.type === "memory") throw new Error("Memory Session history cannot become a memory source");
  if (session.workspace_id && session.workspace_id !== context.workspace?.id) throw new Error("Source Session belongs to another Workspace");
  const page = await host.system.read_agent_session_messages({
    agent_id: context.agent.id, session_id, category, limit: max_messages, max_bytes: 256_000,
  });
  const sources = page.messages.flatMap((raw_message) => {
    const message = raw_message as unknown as PowerJsonObject;
    if (message.role !== "user" && message.role !== "agent") return [];
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts.flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part) || part.type !== "text" || typeof part.text !== "string") return [];
      return [part.text];
    }).join("\n").trim();
    const message_id = typeof message.message_id === "string" ? message.message_id : typeof message.id === "string" ? message.id : "";
    if (!message_id || !text) return [];
    return [{
      source_id: `message:${memory_request_hash([context.agent.id, category, session_id, message_id])}`,
      agent_id: context.agent.id, category, session_id, message_id,
      role: message.role, text,
    } satisfies MemoryJobSource];
  });
  if (!sources.length) throw new Error("Source Session has no readable canonical text messages");
  if (sources.reduce((count, source) => count + source.text.length, 0) > 64_000) throw new Error("Source exceeds 64000 characters; choose a smaller message window");
  if (sources.some((source) => /\b(?:password|secret|api[_ -]?key|access[_ -]?token)\b\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----|\bsk-[a-z0-9_-]{12,}\b/iu.test(source.text))) {
    throw new Error("Source contains potential credentials; select non-sensitive messages");
  }
  return sources;
}
