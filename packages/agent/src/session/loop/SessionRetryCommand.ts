/**
 * 人工 Retry 的原生命令构造器。
 * 接收后恢复原 Turn 的失败 Step；本次调用的资源与结算由普通 Loop 拥有。
 * 命令只持有原请求描述，不能调用旧执行器、旧输出或旧 callback。
 */
import type { SessionCommand } from "@/types/session/SessionCommand.js";
import type { SessionRetryCommandOptions } from "@/types/session/SessionRetryCommand.js";
import { clear_turn_prompt_powers } from "../input/PromptPowers.js";
import { complete_session_turn } from "./SessionTurnCompletion.js";

/** 构造无新增输入、无旧调用方回调的同 Turn 继续调用。 */
export function create_model_retry_command(input: SessionRetryCommandOptions): SessionCommand {
  return { kind: "retry", turn_id: input.replay.turn_id, replay: input.replay, cancel: input.cancel, execute: async () => {
    const active = input.active();
    active.prompt_started = true;
    active.replay = input.replay;
    try {
      const result = await input.execute(active);
      const final_result = await complete_session_turn(input.completion, active, result);
      input.release(active);
      if (!active.settle_after_release) active.deferred_finished.resolve(final_result);
    } finally {
      if (active.turn_context) clear_turn_prompt_powers(active.turn_context);
    }
  } };
}
