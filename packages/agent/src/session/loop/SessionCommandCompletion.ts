/** Session 维护命令的完成信息；观测失败不能改变已提交的领域状态。 */
import type { SessionCommandCompletionInput } from "@/types/session/SessionCommandCompletion.js";

/** 持久化声明的普通 Action，并隔离诊断失败。 */
export async function persist_command_completion(input: SessionCommandCompletionInput): Promise<void> {
  const { completion, turn_id } = input;
  try {
    await input.messages.persist_action({ action_id: completion.id, action_type: "command",
      ...(turn_id ? { turn_id } : {}), title: completion.title,
      ...(completion.description ? { description: completion.description } : {}), status: "completed",
    }, { publish_mutation: completion.publish_mutation !== false });
  } catch (error) {
    try {
      await input.logger.log("warn", "[agent] command completion persistence failed", {
        session_id: input.session_id, command_id: completion.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch { /* 诊断不能反向改变领域状态。 */ }
  }
}
