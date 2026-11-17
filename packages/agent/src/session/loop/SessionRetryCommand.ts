/**
 * 人工 Retry 的原生命令构造器。
 * 接收后创建独立 Turn；生命周期、完成日志和停止都由普通 Loop 拥有。
 * 命令只持有原请求描述，不能调用旧执行器、旧输出或旧 callback。
 */
import type { SessionCommand } from "@/types/session/SessionCommand.js";
import type { SessionRetryCommandOptions } from "@/types/session/SessionRetryCommand.js";
import { clear_turn_prompt_powers } from "../input/PromptPowers.js";
import { complete_session_turn } from "./SessionTurnCompletion.js";

/** 构造无 Prompt、无旧调用方回调的独立执行。 */
export function create_model_retry_command(input: SessionRetryCommandOptions): SessionCommand {
  return { kind: "retry", execute: async () => {
    const active = input.active();
    active.prompt_started = true;
    active.replay = input.replay;
    try {
      const result = await input.execute(active);
      const final_result = await complete_session_turn(input.completion, active, result);
      input.release(active);
      active.deferred_finished.resolve(final_result);
    } finally {
      if (active.turn_context) clear_turn_prompt_powers(active.turn_context);
    }
  } };
}
