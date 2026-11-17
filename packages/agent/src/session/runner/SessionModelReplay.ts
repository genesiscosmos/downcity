/**
 * 失败请求的进程内描述与接收互斥。
 * 不持有活 Turn、工具绑定、信号或等待 Promise；失败执行可立即正常结束。
 */
import type { ModelCall, SessionModelRetry, SessionModelRetryInput, SessionModelRetryResult } from "@downcity/type";
import type { SessionModelReplay, SessionModelInputValidation } from "@/types/session/SessionModelInput.js";
import type { SessionMessages } from "../messages/SessionMessages.js";
import { snapshot_model_input, validate_model_input } from "./SessionModelInput.js";

/** Session 独占的闲置失败请求；串行边界只覆盖短暂接收。 */
export class SessionModelRetryControl {
  private replay?: SessionModelReplay;
  private generation = 0;
  private submitting = false;

  constructor(private readonly messages: SessionMessages, private readonly blocked: () => boolean,
    private readonly start: (replay: SessionModelReplay) => void, private readonly changed: () => void) {}

  /** 只有完全结束原执行且没有新输入时才授予 Retry 能力。 */
  current(): SessionModelRetry | undefined {
    return this.replay && !this.blocked() && !this.submitting ? { ...this.replay.binding } : undefined;
  }

  /** 只缓存值快照和无 Turn 的重绑定工厂；失败发布期间的新输入也使本请求失效。 */
  async prepare_input(call: ModelCall, validate_config?: () => Promise<void>): Promise<SessionModelInputValidation> {
    const generation = this.generation;
    const snapshot = await snapshot_model_input({ call, versions: await this.messages.read_input_versions() });
    return { current: () => generation === this.generation, validate: async () => {
      if (generation !== this.generation) throw new Error("Session input changed");
      await validate_config?.();
      await validate_model_input(snapshot, call, await this.messages.read_input_versions());
      if (generation !== this.generation) throw new Error("Session input changed");
    } };
  }

  /** 登记失败描述后立即返回；执行所有者负责正常 finished 和资源释放。 */
  capture(replay: SessionModelReplay): void {
    this.replay = { ...replay, call: structuredClone(replay.call) };
    this.changed();
  }

  /** 同一锚点最多接收一次；接收未知由调用方读取权威快照。 */
  async submit(input: SessionModelRetryInput): Promise<SessionModelRetryResult> {
    const replay = this.replay;
    if (this.submitting || this.blocked() || !replay
      || replay.binding.message_id !== input.message_id || replay.binding.error_part_id !== input.error_part_id) {
      return { accepted: false, reason: "Failure unavailable or Session is busy" };
    }
    this.submitting = true;
    const generation = this.generation;
    try {
      const versions = await this.messages.read_input_versions();
      if (versions.has_pending_interactions) return { accepted: false, reason: "Resolve the pending interaction before retrying" };
      try { await replay.validate(); } catch (error) {
        this.notify_input();
        return { accepted: false, reason: error instanceof Error ? error.message : "Original input unavailable" };
      }
      if (this.blocked() || generation !== this.generation || this.replay !== replay) {
        return { accepted: false, reason: "Session input changed" };
      }
      // 最终接收与入队同步完成，不在删除 Banner 的 I/O 间隙释放互斥。
      this.replay = undefined;
      this.start(replay);
      return { accepted: true };
    } finally {
      this.submitting = false;
      this.changed();
    }
  }

  /** 新输入、配置、停止或释放使旧请求失效；不影响任何执行的收尾。 */
  notify_input(): void {
    this.generation += 1;
    this.replay = undefined;
    this.changed();
  }
}
