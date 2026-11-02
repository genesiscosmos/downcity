/** Memory 有界执行上下文：复用标准装配，不压缩原始证据，达到预算后明确失败。 */
import { DefaultSessionComposer } from "@downcity/agent";
import type { SessionComposeInput, SessionContextAdvanceInput, SessionStepInput } from "@downcity/agent";

/** 每个 Job 使用独立 Session，避免跨 Job 摘要成为新的证据。 */
export class MemoryComposer extends DefaultSessionComposer {
  /** 在每次模型调用前检查持久历史体量与工具调用预算。 */
  override async compose(input: SessionComposeInput): Promise<SessionStepInput> {
    const serialized = JSON.stringify(input.history);
    if (Buffer.byteLength(serialized, "utf8") > 512_000) throw new Error("Memory Session history budget exceeded");
    const tool_calls = input.history.reduce((count, message) => count + message.parts.filter((part) => part.type === "tool").length, 0);
    if (tool_calls > 40 || input.history.length > 80) throw new Error("Memory Session execution budget exceeded");
    return await super.compose(input);
  }

  /** 有界来源不能通过摘要丢失证据后继续推断，超窗由 Job 报告失败。 */
  override async advance_context(_input: SessionContextAdvanceInput): Promise<boolean> { return false; }
}
