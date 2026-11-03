/** 可信事实接收：固定范围、来源角色与指纹；只接收明确命令，不通过模型猜测用户意图。 */
import { z } from "zod";
import type { MemorySignalInput, MemorySignal } from "../types/MemoryDream.js";
import { MemorySignalStore } from "../storage/MemorySignalStore.js";
import { memory_request_hash } from "./MemorySources.js";

const signal_schema = z.object({
  event_id: z.string().min(1).max(300), event_type: z.enum(["user_correction", "task_accepted"]),
  producer: z.enum(["task", "explicit_user"]), occurred_at: z.iso.datetime(),
  agent_id: z.string().min(1), workspace_id: z.string().min(1).optional(), target: z.enum(["agent", "current_workspace"]),
  workspace_share_allowed: z.boolean(), source_boundary: z.string().min(1).max(4000), source_error: z.string().optional(),
  sources: z.array(z.object({
    source_id: z.string().min(1).max(400), agent_id: z.string().min(1), category: z.string().min(1),
    session_id: z.string().optional(), message_id: z.string().optional(), role: z.enum(["user", "agent", "request"]),
    text: z.string().min(1).max(24000),
  }).strict()).min(1).max(8),
}).strict();

export class MemorySignalIntake {
  constructor(private readonly store: MemorySignalStore) {}

  /** 落盘后才确认接收；重复输入收敛，稳定身份复用不同正文明确报错。 */
  async receive(raw_input: MemorySignalInput): Promise<MemorySignal> {
    const input = signal_schema.parse(raw_input);
    if (input.target === "current_workspace" && (!input.workspace_id || !input.workspace_share_allowed)) {
      throw new Error("Workspace memory requires explicit source sharing permission");
    }
    if (input.producer === "explicit_user" && input.event_type !== "user_correction") throw new Error("Explicit input must be a correction");
    if (input.sources.some((source) => source.agent_id !== input.agent_id
      || (input.producer === "task" ? source.category !== "task" || source.role === "user" : source.category !== "manual" || source.role !== "user")
      || /^(?:memory|job|dream|profile|delivery):/u.test(source.source_id))) {
      throw new Error("Memory outputs and foreign Agent sources cannot become original evidence");
    }
    if (input.sources.reduce((total, source) => total + source.text.length, 0) > 32000) throw new Error("Signal source budget exceeded");
    const contains_credentials = input.sources.some((source) => /\b(?:password|secret|api[_ -]?key|access[_ -]?token)\b\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----|\bsk-[a-z0-9_-]{12,}\b/iu.test(source.text));
    if (contains_credentials) throw new Error("Source contains potential credentials; provide non-sensitive evidence");
    const fingerprint = memory_request_hash(input);
    const signal_id = memory_request_hash([input.producer, input.event_id, input.agent_id, input.workspace_id, input.target]);
    return await this.store.mutate(input, (ledger) => {
      const existing = ledger.signals.find((signal) => signal.signal_id === signal_id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("Memory event identity reused with different source boundary or content");
        return existing;
      }
      const signal: MemorySignal = { ...input, signal_id, fingerprint, sequence: ledger.accepted_cursor + 1,
        received_at: new Date().toISOString(), state: input.source_error ? "error" : "received" };
      ledger.signals.push(signal);
      ledger.accepted_cursor = signal.sequence;
      if (input.source_error) ledger.last_error = input.source_error;
      return signal;
    });
  }
}
