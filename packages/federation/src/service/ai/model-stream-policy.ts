/**
 * 模型事件流期限：响应流建立、首个有效输出、输出空闲与整体执行期限。
 *
 * 首输出和空闲预算只消耗等待上游 open/read 的时间，消费端背压不消耗该预算。
 * 元数据及空增量不重置预算；总期限始终计时。终态后不等待上游无限 EOF，
 * 不伪造用量、不重试模型，也不主动缓冲事件。
 */
import { guard_model_stream, resolve_model_stream_policy, is_model_output_event } from "@downcity/type";
import type { AIChannelStreamResult, AIModelStreamPolicy } from "../../types/AI.js";
import type { Context } from "../service.js";

export { resolve_model_stream_policy, is_model_output_event };

/** 服务端拥有策略和取消信号，实际 open/read 生命周期复用协议层守护器。 */
export async function execute_model_stream(ctx: Context, open: () => Promise<unknown>,
  policy: AIModelStreamPolicy): Promise<AIChannelStreamResult> {
  const parents = [ctx.abort_signal, ctx.request?.signal].filter((signal): signal is AbortSignal => signal !== undefined);
  return guard_model_stream(async (signal) => {
    ctx.abort_signal = signal;
    const result = await open();
    if (!result || typeof result !== "object" || !("stream" in result)) {
      throw new Error("AIChannel did not return a model event stream");
    }
    return result as AIChannelStreamResult;
  }, parents.length ? AbortSignal.any(parents) : undefined, policy);
}
