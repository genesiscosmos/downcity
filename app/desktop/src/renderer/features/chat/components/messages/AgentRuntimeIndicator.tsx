/** Agent Session 运行状态的统一消息内与独立展示。 */

import type { SessionTurnFileDiffSummary } from "@downcity/agent";
import { AgentMessageFrame } from "@/features/chat/components/messages/AgentMessageFrame";
import { use_translation } from "@/locales/i18n";
import type { DesktopAgentSummary, DesktopChatRuntime } from "@common/types/DesktopApi";

/**
 * 思考中的点阵 + 文案，以及可选的实时文件改动统计。
 *
 * 单独导出是因为「Agent 正在做什么」有三种表达场景，而它们必须长得一样：
 * Session 消息流里的独立状态行、Session 流式消息的 Footer、Group 成员的输入状态。
 * 主文案由调用方给出（Group 说的是「正在输入…」，Session 说的是「思考中」）；
 * 文件改动那句属于这里，因为它的点阵、间距与正负号配色是同一套。
 *
 * **live region 就挂在这个元素上**，而不是外层的行容器：变化的是这里的文案，
 * 而且三个场景各只有一个实例，因此既不会重复播报，也不会因为外层容器换了语义就丢掉。
 */
export function AgentThinkingStatus({ label, file_diff }: { /** 主状态文案。 */ label: string; /** 当前 Turn 最新文件改动摘要；为 0 时不显示。 */ file_diff?: SessionTurnFileDiffSummary }) {
  const translate_chat = use_translation("chat");
  return <span className="activity-tool-main h-5" role="status" aria-live="polite">
    <span className="thinking-dots-icon" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className="thinking-dot" />)}</span>
    <span className="thinking-status-label">{label}</span>
    {file_diff && file_diff.files_count > 0 ? <span className="thinking-file-diff">
      <span className="thinking-status-label">{translate_chat("message.files_changed", { count: file_diff.files_count })}</span>
      <span className="thinking-file-diff-stats">
        <span className="text-emerald-600 dark:text-emerald-400">+{file_diff.additions}</span>
        <span className="text-red-500 dark:text-red-400">-{file_diff.deletions}</span>
      </span>
    </span> : null}
  </span>;
}

/**
 * 展示 Agent 正在提交、生成或等待输入的运行状态。
 *
 * 两种形态都必须与 Agent Message 共用同一条左边缘与同一条身份行高度，
 * 否则「思考中」会比它上面那条消息缩进一截，滚动时看得出跳。因此这里不自己写几何：
 *
 * - `compact`：嵌在消息 Footer 里，由 AgentMessage 自己包 Footer，这里只返回状态行本身；
 * - 独立形态：与 Agent Message 同构（身份在上、状态在下），语义是 status 而非 message
 *   （状态变化会被读屏播报，而正式消息不该被播报）。
 *
 * 独立形态的身份行是纯展示（不可点）：它是一行状态，不是一条消息，
 * 不该再提供一个打开 Agent 配置的入口。
 */
export function AgentRuntimeIndicator({ agent, status, compact = false, file_diff }: { /** 当前 Agent；非紧凑状态下用于显示身份。 */ agent?: DesktopAgentSummary; /** 当前运行阶段。 */ status?: DesktopChatRuntime["status"]; /** 是否嵌入 Agent Message Footer。 */ compact?: boolean; /** 当前 Turn 最新文件改动摘要。 */ file_diff?: SessionTurnFileDiffSummary }) {
  const translate_chat = use_translation("chat");
  const label = translate_chat(status === "submitted" ? "message.submitting" : status === "waiting_input" ? "message.waiting_input" : "activity.thinking");
  if (compact || !agent) return <AgentThinkingStatus label={label} file_diff={file_diff} />;
  return <AgentMessageFrame agent={agent} semantic="status" footer={<AgentThinkingStatus label={label} file_diff={file_diff} />} />;
}
