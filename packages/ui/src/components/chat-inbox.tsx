/**
 * Agent Message 内运行时输入复用普通工具与推理项的折叠行和详情容器。
 *
 * 默认仅显示易读标题与非空内容数量；展开后按原顺序挂载纯文本、context 与附件引用。
 * 空内容提供明确提示，命令输出使用等宽字体，其他正文沿用阅读字体。
 * 原始事件类别与关联 ID 收在二级来源详情里，避免干扰对话阅读。
 * React 负责文本转义，组件不加载附件、不解释 Markdown，也不把事件内容混入 Agent 正文。
 */
import { useState } from "react";
import { File, Inbox, Paperclip, Terminal, ListTree } from "lucide-react";
import type { DowncityChatInboxPart } from "../types/chat-inbox";
import { TbChevronRight } from "./chat-icons";

/** 运行时输入折叠视图的属性。 */
interface ChatInboxProps {
  /** 已经过 UI adapter 筛选的独立 inbox Part。 */
  part: DowncityChatInboxPart;
}

/** 展示独立的运行时输入，保留其在消息内部的原始位置。 */
export function ChatInbox({ part }: ChatInboxProps) {
  const [expanded, set_expanded] = useState(false);
  const title = inbox_title(part.kind);
  const display_content = part.content.filter((item) => item.type === "file"
    || (item.type === "context" ? item.context : item.text).trim().length > 0);
  const file_count = display_content.filter((item) => item.type === "file").length;
  const text_count = display_content.length - file_count;
  const count_label = [text_count ? `${text_count} 段内容` : "", file_count ? `${file_count} 个附件` : ""]
    .filter(Boolean).join(" · ") || "无内容";
  const Icon = part.kind === "shell_result" ? Terminal
    : part.kind === "tool_media" ? Paperclip
    : part.kind === "delegation_result" || part.kind === "task" ? ListTree : Inbox;
  return <details className="dc-chat-activity-row" onToggle={(event) => {
    if (event.target === event.currentTarget) set_expanded(event.currentTarget.open);
  }}>
    <summary className="dc-chat-activity-summary">
      <span className="dc-chat-activity-main">
        <Icon aria-hidden />
        <span className="dc-chat-activity-state">{title}</span>
        <span className="dc-chat-activity-name">{count_label}</span>
        <TbChevronRight className="dc-chat-activity-chevron" aria-hidden />
      </span>
    </summary>
    {expanded ? <div className="dc-chat-activity-terminal dc-chat-inbox-details" tabIndex={0} role="region" aria-label={title}>
      {display_content.length ? <div className={`dc-chat-inbox-content${part.kind === "shell_result" ? " dc-chat-inbox-command" : ""}`}>
        {display_content.map((item, index) => item.type === "file"
          ? <span className="dc-chat-attachment" key={index} title={item.url}><File aria-hidden /><span>{item.filename || "附件"}</span></span>
          : <div key={index} className="dc-chat-inbox-entry">
            {item.type === "context" ? <span className="dc-chat-inbox-context-tag">{item.tag}</span> : null}
            <div className="dc-chat-inbox-text">{item.type === "context" ? item.context : item.text}</div>
          </div>)}
      </div> : <p className="dc-chat-inbox-empty">暂无可展示内容。</p>}
      <details className="dc-chat-inbox-source">
        <summary>来源</summary>
        <dl>
          <dt>事件类型</dt><dd>{part.kind}</dd>
          {part.source?.tool_call_id ? <><dt>Tool Call ID</dt><dd>{part.source.tool_call_id}</dd></> : null}
          {part.source?.turn_id ? <><dt>Turn ID</dt><dd>{part.source.turn_id}</dd></> : null}
        </dl>
      </details>
    </div> : null}
  </details>;
}

/** 只为已知生产语义指定标题；扩展事件保留通用入口。 */
function inbox_title(kind: string): string {
  switch (kind) {
    case "shell_result": return "命令结果";
    case "delegation_result": return "任务结果";
    case "power_result": return "后台结果";
    case "tool_media": return "收到附件";
    case "task": return "任务指令";
    case "memory": return "记忆处理";
    case "maintenance": return "上下文维护";
    case "incomplete_response_recovery": return "回复续写";
    case "max_steps_finalization": return "执行收尾";
    default: return "运行时输入";
  }
}
