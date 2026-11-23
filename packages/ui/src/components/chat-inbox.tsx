/**
 * Agent Message 内运行时输入复用普通工具与推理项的折叠行和详情容器。
 *
 * 默认仅显示易读标题与非空内容数量；展开后按原顺序挂载纯文本、context 与附件引用。
 * 空内容提供明确提示，命令输出使用等宽字体，其他正文沿用阅读字体。
 * 原始事件类别与关联 ID 收在二级来源详情里，避免干扰对话阅读。
 * React 负责文本转义，组件不加载附件、不解释 Markdown，也不把事件内容混入 Agent 正文。
 */
import { useState } from "react";
import { use_control_translation } from "../lib/control-messages";
import { File, Inbox, MessageCircle, Pill, Terminal, ListTree } from "lucide-react";
import type { DowncityChatInputPart } from "../types/chat-runtime-input";
import { TbChevronRight } from "./chat-icons";

/** 运行时输入折叠视图的属性。 */
interface ChatInputProps {
  /** 已经过 UI adapter 筛选的独立 input Part。 */
  part: DowncityChatInputPart;
}

/** 展示独立的运行时输入，保留其在消息内部的原始位置。 */
export function ChatInput({ part }: ChatInputProps) {
  const [expanded, set_expanded] = useState(false);
  const translate = use_control_translation("chat");
  const title = translate(input_title(part));
  const display_content = part.content.filter((item) => item.type === "file"
    || (item.type === "context" ? item.context : item.text).trim().length > 0);
  const file_count = display_content.filter((item) => item.type === "file").length;
  const text_count = display_content.length - file_count;
  const count_label = [text_count ? `${text_count} 段内容` : "", file_count ? `${file_count} 个附件` : ""]
    .filter(Boolean).join(" · ") || "无内容";
  const Icon = part.kind === "delegation_result" ? MessageCircle
    : part.kind === "shell_result" ? Terminal
    : part.kind === "tool_media" && part.content.some(item => item.type === "context" && item.tag === "skill") ? Pill
    : part.kind === "task" ? ListTree : Inbox;
  return <details className="dc-chat-activity-row is-incoming" onToggle={(event) => {
    if (event.target === event.currentTarget) set_expanded(event.currentTarget.open);
  }}>
    <summary className="dc-chat-activity-summary">
      <span className="dc-chat-activity-main">
        <span className="dc-chat-input-icon" aria-hidden><Icon /></span>
        <span className="dc-chat-activity-state">{title}</span>
        <span className="dc-chat-activity-name">{count_label}</span>
        <TbChevronRight className="dc-chat-activity-chevron" aria-hidden />
      </span>
    </summary>
    {expanded ? <div className="dc-chat-activity-terminal dc-chat-input-details" tabIndex={0} role="region" aria-label={title}>
      {display_content.length ? <div className={`dc-chat-input-content${part.kind === "shell_result" ? " dc-chat-input-command" : ""}`}>
        {display_content.map((item, index) => item.type === "file"
          ? <span className="dc-chat-attachment" key={index} title={item.url}><File aria-hidden /><span>{item.filename || "附件"}</span></span>
          : <div key={index} className="dc-chat-input-entry">
            {item.type === "context" ? <span className="dc-chat-input-context-tag">{item.tag}</span> : null}
            <div className="dc-chat-input-text">{item.type === "context" ? item.context : item.text}</div>
          </div>)}
      </div> : <p className="dc-chat-input-empty">暂无可展示内容。</p>}
      <details className="dc-chat-input-source">
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
function input_title(part: DowncityChatInputPart): string {
  if (part.kind === "tool_media" && part.content.some(item => item.type === "context" && item.tag === "skill")) return "runtime_input.skill";
  switch (part.kind) {
    case "shell_result": return "runtime_input.command_result";
    case "delegation_result": return "runtime_input.work_result";
    case "power_result": return "runtime_input.background_result";
    case "tool_media": return "runtime_input.attachment";
    case "task": return "runtime_input.task";
    case "memory": return "runtime_input.memory";
    case "maintenance": return "runtime_input.maintenance";
    case "incomplete_response_recovery": return "runtime_input.recovery";
    case "max_steps_finalization": return "runtime_input.finalization";
    default: return "runtime_input.message";
  }
}
