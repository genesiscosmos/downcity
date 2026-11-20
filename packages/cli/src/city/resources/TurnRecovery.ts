/** TUI SDK 流断开后的权威结果恢复；request_id 由客户端预先分配，不重复发送输入。 */
import { randomUUID } from "node:crypto";
import type { RemoteAgentSession, AgentSessionTurnResult } from "@downcity/agent";
import type { ResourceService } from "@downcity/city/local";
import { ResourceError } from "@downcity/city/local";
import { ResourceClient } from "./ResourceClient.js";

/** 只包装 prompt，其他 SDK 方法保留原实例 this 和安全 Interaction 能力。 */
export function recoverable_chat_session(session: RemoteAgentSession, client: ResourceClient, agent_id: string): RemoteAgentSession {
  return new Proxy(session, { get(target, property) {
    if (property !== "prompt") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
    return async (input: Parameters<RemoteAgentSession["prompt"]>[0]) => {
      const request_id = input.request_id ?? randomUUID();
      const address = { agent: agent_id, type: target.type, session_id: target.id, request_id };
      const deadline = Date.now() + 300_000;
      const recover = async (): Promise<AgentSessionTurnResult> => {
        while (Date.now() < deadline) {
          const result = await client.call("session.receipt", address);
          const receipt = result.data as Awaited<ReturnType<ResourceService["sessions"]["receipt"]>>;
          if (receipt.completed && receipt.result) return receipt.result as AgentSessionTurnResult;
          if (!receipt.accepted || receipt.execution_state === "interrupted") throw new ResourceError("host_unreachable", "Input outcome was verified; retry the original request ID explicitly to resume if desired", 5, false, { ...receipt, outcome: receipt.accepted ? "accepted" : "not_accepted" });
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
        throw new ResourceError("operation_timeout", "Recovered Turn is still active; host execution continues", 7, false, { request_id, outcome: "accepted" });
      };
      let handle;
      try { handle = await target.prompt({ ...input, request_id }); }
      catch (error) {
        const verified = await client.call("session.receipt", address).catch(() => { throw new ResourceError("host_unreachable", "Cannot verify input after transport loss", 5, false, { request_id, outcome: "unknown" }); });
        const receipt = verified.data as Awaited<ReturnType<ResourceService["sessions"]["receipt"]>>;
        if (!receipt.accepted || !receipt.turn_id) throw new ResourceError("host_unreachable", "Input was not accepted", 5, false, { ...receipt, outcome: receipt.accepted ? "accepted" : "not_accepted" });
        const finished = receipt.completed && receipt.result ? Promise.resolve(receipt.result as AgentSessionTurnResult) : recover();
        return { id: receipt.turn_id, result: receipt.result as AgentSessionTurnResult | null, finished };
      }
      return { id: handle.id, get result() { return handle.result; }, finished: handle.finished.catch(async (error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "transport_lost")) throw error;
        try { return await recover(); }
        catch (recovery_error) {
          if (recovery_error instanceof ResourceError && recovery_error.details.outcome) throw recovery_error;
          throw new ResourceError("host_unreachable", "Cannot verify Turn after transport loss", 5, false, { request_id, turn_id: handle.id, outcome: "unknown" });
        }
      }) };
    };
  } });
}
