/**
 * SDK 请求级 Power 执行器：保存函数、按 call_id 去重、取消与提交结果。
 * 每次 Prompt 独立创建，Turn 终态后释放，不暴露绑定接口。
 */
import { describe_prompt_powers, execute_prompt_power, snapshot_prompt_powers } from "@downcity/agent";
import type { PromptPower, PromptPowerEvent, PromptPowerResult } from "@downcity/type";
import type { PromptPowerChannel } from "@/types/remote/PromptPowerTransport.js";

/** 单次 Prompt 的调用方执行注册。 */
export class PromptPowerExecution {
  readonly powers: readonly PromptPower[];
  readonly descriptors;
  private channel: PromptPowerChannel | undefined;
  private closed = false;
  private readonly controllers = new Map<string, AbortController>();
  private readonly results = new Map<string, Promise<PromptPowerResult>>();
  private readonly buffered: PromptPowerEvent[] = [];
  private readonly signal_cleanups: (() => void)[] = [];

  constructor(powers: readonly PromptPower[]) {
    this.powers = snapshot_prompt_powers(powers);
    this.descriptors = describe_prompt_powers(this.powers);
    for (const power of this.powers) power.abort_signal?.throwIfAborted();
    for (const power of this.powers) {
      const abort = () => { void this.close().catch(() => {}); };
      power.abort_signal?.addEventListener("abort", abort, { once: true });
      this.signal_cleanups.push(() => power.abort_signal?.removeEventListener("abort", abort));
    }
  }

  /** 通道 ready 后装配；缓冲建立期间到达的事件。 */
  attach(channel: PromptPowerChannel): void {
    this.channel = channel;
    if (this.closed) { void channel.close().catch(() => {}); throw new Error("Caller Power unavailable"); }
    for (const event of this.buffered.splice(0)) this.on_event(event);
  }

  /** 事件处理不得阻塞事件流，结果提交与下一事件接收并行。 */
  on_event(event: PromptPowerEvent): void {
    if (this.closed) return;
    if (!this.channel) { this.buffered.push(event); return; }
    if (event.type === "cancel") {
      this.controllers.get(event.call_id)?.abort(new Error("Power execution cancelled"));
      return;
    }
    const call = event.call;
    let operation = this.results.get(call.call_id);
    if (!operation) {
      const controller = new AbortController();
      this.controllers.set(call.call_id, controller);
      operation = (async (): Promise<PromptPowerResult> => {
        try {
          const power = this.powers.find((item) => item.name === call.power_name);
          if (!power) throw new Error(`Unknown caller Power: ${call.power_name}`);
          const output = await execute_prompt_power(power, call.action_name, call.input, {
            agent_id: call.agent_id, session_id: call.session_id, turn_id: call.turn_id,
            tool_call_id: call.tool_call_id, call_id: call.call_id, abort_signal: controller.signal,
          });
          return { call_id: call.call_id, output };
        } catch (error) {
          return { call_id: call.call_id, error: (error instanceof Error ? error.message : String(error)).slice(0, 16000) };
        } finally { this.controllers.delete(call.call_id); }
      })();
      this.results.set(call.call_id, operation);
    }
    void operation.then(async (result) => {
      if (!this.closed) await this.channel!.result(result);
    }).catch(() => { void this.close(); });
  }

  /** 取消所有在途 Action，释放缓存与网络订阅。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const cleanup of this.signal_cleanups.splice(0)) cleanup();
    for (const controller of this.controllers.values()) controller.abort(new Error("Prompt Power execution closed"));
    this.controllers.clear();
    this.results.clear();
    this.buffered.length = 0;
    await this.channel?.close();
  }
}
