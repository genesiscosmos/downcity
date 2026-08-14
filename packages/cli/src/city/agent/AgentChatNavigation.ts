/**
 * Agent Chat 的页面导航流程。
 *
 * 关键点（中文）
 * - Chat TUI 只产生导航意图，不直接打开另一个终端运行时。
 * - 配置页在 alternate screen 完全关闭后运行，结束后恢复退出前的 Session。
 */

import { run_agent_chat_tui } from "@/city/agent/AgentChatTui.js";
import type { AgentChatNavigationOptions } from "@/city/types/AgentChatTui.js";

/**
 * 运行 Chat，并在用户请求配置时完成 Chat → 配置 → 原 Chat 的闭环导航。
 *
 * @param options Agent、初始 Session、远程客户端与配置页回调。
 */
export async function run_agent_chat_navigation(
  options: AgentChatNavigationOptions,
): Promise<void> {
  let session_id = options.session_id;

  while (true) {
    const result = await run_agent_chat_tui({
      agent_id: options.agent_id,
      session_id,
      remote_agent: options.remote_agent,
    });
    if (result.action === "exit") return;

    session_id = result.session_id;
    await options.configure_agent(options.agent_id);
  }
}
