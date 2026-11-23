/**
 * 可信后台结果的幂等接收屏障。
 * 持久化消息提供跨重启去重，进程内屏障合并并发重试；具体 Turn 接收窗口仍由 SessionLoop 决定。
 */
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { PromptRequestIdentity } from "@/types/session/SessionLoop.js";
import type { SessionMessages } from "../messages/SessionMessages.js";
import { resolve_prompt_request_identity } from "./SessionTurnHandles.js";
import { read_prompt_input } from "./SessionInputFacts.js";

/** 一个正在等待 canonical 接收确认的后台结果。 */
interface PendingSessionResult {
  /** 首次投递绑定的原始 Turn，禁止同一请求跨 Turn 复用。 */
  readonly turn_id: string;
  /** 所有同键重试共享的接收确认；失败后允许重新投递。 */
  readonly receipt: Promise<boolean>;
}

/** 单个 Session 内的可信结果接收器，不拥有执行和调度权限。 */
export class SessionResultAcceptance {
  /** 尚未完成持久化确认的稳定请求。 */
  private readonly pending = new Map<string, PendingSessionResult>();

  constructor(
    /** 目标 Session 的稳定标识，用于解析 canonical 消息身份。 */
    private readonly session_id: string,
    /** canonical 消息读取端口，是跨重启接收确认的事实源。 */
    private readonly messages: Pick<SessionMessages, "read_message" | "read_input">,
  ) {}

  /** 相同请求只能接收一次；是否能注入原 Turn 由同步检查并入队的回调决定。 */
  async accept(
    turn_id: string,
    request_id: string,
    query: AgentSessionPromptInput["query"],
    enqueue: (identity: PromptRequestIdentity, query: AgentSessionPromptInput["query"]) => Promise<boolean>,
  ): Promise<boolean> {
    const identity = resolve_prompt_request_identity(this.session_id, request_id);
    if (!identity || !turn_id.trim()) throw new Error("Delegation result requires Turn and request identities");
    const pending = this.pending.get(identity.input_id);
    if (pending) {
      if (pending.turn_id !== turn_id) throw new Error("Delegation result belongs to another Turn");
      return await pending.receipt;
    }
    const receipt = (async () => {
      const existing = await read_prompt_input(this.messages, identity);
      if (existing) {
        if ("role" in existing.input || existing.input.source?.turn_id !== turn_id) {
          throw new Error("Delegation result belongs to another Turn");
        }
        return true;
      }
      return await enqueue(identity, query);
    })();
    this.pending.set(identity.input_id, { turn_id, receipt });
    try {
      return await receipt;
    } finally {
      this.pending.delete(identity.input_id);
    }
  }
}
