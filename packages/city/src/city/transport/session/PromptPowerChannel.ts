/**
 * 服务端请求级 Power 执行通道：持有待完成调用，生成代理 Power，并在关闭时取消执行。
 * 实例由 HTTP 流或 RPC socket 订阅拥有，不进入 City 的长期 Power 注册表。
 */
import { randomUUID } from "node:crypto";
import { describe_prompt_powers } from "@downcity/agent";
import { z } from "zod";
import type { PromptPower, PromptPowerEvent, PromptPowerResult, PromptPowerCall, ModelJsonValue } from "@downcity/type";
import type { RemotePromptInput, PendingPromptPowerCall } from "@/types/remote/PromptPowerTransport.js";

/** 服务端单次 Prompt 的执行通道。 */
export class ServerPromptPowerChannel {
  readonly id = randomUUID();
  readonly abort_controller = new AbortController();
  private readonly pending = new Map<string, PendingPromptPowerCall>();
  private readonly completed = new Set<string>();
  private claimed = false;
  private idle_timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly session_key: string,
    private readonly send: (event: PromptPowerEvent) => void,
  ) {
    // 已建立但没有提交 Prompt 的通道不能长期占用资源。
    this.idle_timer = setTimeout(() => this.close(), 30000);
    this.idle_timer.unref?.();
  }

  /** 一个通道仅供一次 Prompt 使用，拒绝跨 Session 引用和执行方接管。 */
  prepare(input: RemotePromptInput, session_key: string): PromptPower[] {
    if (session_key !== this.session_key || input.execution_channel_id !== this.id) throw new Error("Power channel does not belong to this Session");
    if (this.claimed || this.abort_controller.signal.aborted) throw new Error("Power execution channel is unavailable");
    const descriptors = describe_prompt_powers(input.powers ?? []);
    this.claimed = true;
    clearTimeout(this.idle_timer);
    this.idle_timer = undefined;
    return descriptors.map((power) => ({
      ...power,
      abort_signal: this.abort_controller.signal,
      actions: Object.fromEntries(Object.entries(power.actions).map(([name, action]) => [name, {
        ...action,
        execute: async (payload, context) => await this.call({
          agent_id: context.agent_id, session_id: context.session_id,
          turn_id: context.turn_id, tool_call_id: context.tool_call_id,
          call_id: context.call_id, power_name: power.name, action_name: name, input: payload,
        }, context.abort_signal),
      }])),
    }));
  }

  private async call(call: PromptPowerCall, signal: AbortSignal): Promise<ModelJsonValue> {
    signal.throwIfAborted();
    this.abort_controller.signal.throwIfAborted();
    if (this.pending.size >= 32 || this.completed.size >= 4096) throw new Error("Power channel call limit exceeded");
    return await new Promise<ModelJsonValue>((resolve, reject) => {
      const abort = () => {
        this.send({ type: "cancel", call_id: call.call_id });
        this.pending.get(call.call_id)?.reject(new Error("Power execution cancelled"));
      };
      const finish = () => {
        signal.removeEventListener("abort", abort);
        this.pending.delete(call.call_id);
        this.completed.add(call.call_id);
      };
      this.pending.set(call.call_id, {
        resolve: (value) => { finish(); resolve(value); },
        reject: (error) => { finish(); reject(error); },
      });
      signal.addEventListener("abort", abort, { once: true });
      try { this.send({ type: "call", call }); }
      catch (error) { this.pending.get(call.call_id)?.reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /** 相同调用终态只提交一次；迟到和未知结果均不注入模型。 */
  result(result: PromptPowerResult): void {
    const parsed = z.object({ call_id: z.string(), output: z.json().optional(), error: z.string().max(16000).optional() }).strict().parse(result);
    if (Buffer.byteLength(JSON.stringify(parsed)) > 1048576) throw new Error("Power result exceeds 1 MiB");
    if (this.completed.has(parsed.call_id)) return;
    const pending = this.pending.get(parsed.call_id);
    if (!pending) throw new Error("Unknown or terminated Power call");
    if (parsed.error !== undefined) pending.reject(new Error(parsed.error));
    else if (parsed.output !== undefined) pending.resolve(parsed.output);
    else throw new Error("Power result requires output or error");
  }

  /** 关闭幂等；中断所有等待并通知当前 Turn。 */
  close(): void {
    if (this.abort_controller.signal.aborted) return;
    clearTimeout(this.idle_timer);
    this.abort_controller.abort(new Error("Caller Power execution channel closed"));
    for (const pending of this.pending.values()) pending.reject(new Error("Caller Power execution channel closed"));
    this.pending.clear();
    this.completed.clear();
  }
}
