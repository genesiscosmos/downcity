/**
 * Shell runtime 生命周期 action。
 *
 * 关键点（中文）
 * - 负责绑定宿主上下文与关闭当前 state 下的所有 shell。
 * - 不处理单个 shell 的 start/read/write 等业务动作。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import { terminate_shell_session_process } from "../ShellProcessLifecycle.js";

/**
 * 绑定当前 shell runtime 实例的 execution runtime。
 */
export function bindShellRuntime(
  state: ShellRuntimeState,
  context: ShellHostContext,
): void {
  state.context = context;
}

/**
 * 关闭当前实例持有的所有活动 shell。
 */
export async function closeAllShellSessions(
  state: ShellRuntimeState,
  force = false,
): Promise<void> {
  const active_sessions = Array.from(state.sessions.values()).filter(
    (session) => session.snapshot.status === "running"
      || session.snapshot.status === "starting",
  );
  const close_results = await Promise.all(
    active_sessions.map(async (session) => ({
      shell_id: session.snapshot.shellId,
      process_exited: await terminate_shell_session_process(session, force),
    })),
  );
  const failed_shell_ids = close_results
    .filter((result) => !result.process_exited)
    .map((result) => result.shell_id);
  if (failed_shell_ids.length > 0) {
    throw new Error(
      `Shell processes did not exit after termination: ${failed_shell_ids.join(", ")}`,
    );
  }
}
