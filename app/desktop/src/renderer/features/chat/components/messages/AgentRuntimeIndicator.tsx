/** Agent Session 运行状态的统一消息内与独立展示。 */

import type { SessionTurnFileDiffSummary } from "@downcity/agent";
import { AgentAvatar } from "@/components/AgentAvatar";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary, DesktopChatRuntime } from "@common/types/DesktopApi";

/** 展示 Agent 正在提交、生成或等待输入的运行状态。 */
export function AgentRuntimeIndicator({ agent, status, compact = false, file_diff }: { /** 当前 Agent；非紧凑状态下用于显示身份。 */ agent?: DesktopAgentSummary; /** 当前运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入 Agent Message Footer。 */ compact?: boolean; /** 当前 Turn 最新文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary }) {
  const translate_chat = use_translation("chat");
  const status_content = <span className="activity-tool-main h-5"><span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span><span className="thinking-status-label">{translate_chat(status === "submitted" ? "message.submitting" : status === "waiting_input" ? "message.waiting_input" : "activity.thinking")}</span>{status === "streaming" && file_diff && file_diff.files_count > 0 ? <span className="thinking-file-diff"><span className="thinking-status-label">{translate_chat("message.files_changed", { count: file_diff.files_count })}</span><span className="thinking-file-diff-stats"><span className="text-emerald-600 dark:text-emerald-400">+{file_diff.additions}</span><span className="text-red-500 dark:text-red-400">-{file_diff.deletions}</span></span></span> : null}</span>;
  if (compact || !agent) return <div className="agent-message-footer flex h-6 min-h-6 items-center pl-1" role="status" aria-live="polite">{status_content}</div>;
  return <div className="group is-agent flex w-full items-start gap-2 py-2 !m-0 !p-0" role="status" aria-live="polite">
    <div className="shrink-0 px-1 pt-0.5"><AgentAvatar agent={agent} class_name="size-7 rounded-md" /></div>
    <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-visible pt-0.5 text-sm text-foreground">
      <div className="min-w-0 truncate text-xs font-medium text-foreground">{agent.name}</div>
      <div className="agent-message-footer flex items-center">{status_content}</div>
    </div>
  </div>;
}
