/**
 * Agent Message 内运行时输入的独立折叠视图。
 *
 * 默认仅显示事件类别与一行预览；展开后按原顺序显示纯文本、context 与附件引用。
 * React 负责文本转义，组件不加载附件、不解释 Markdown，也不把事件内容混入 Agent 正文。
 */
import { File, Inbox } from "lucide-react";
import type { DowncityChatInboxPart } from "../types/chat-inbox";
import { TbChevronRight } from "./chat-icons";

/** 运行时输入折叠视图的属性。 */
interface ChatInboxProps {
  /** 已经过 UI adapter 筛选的独立 inbox Part。 */
  part: DowncityChatInboxPart;
}

/** 展示独立的运行时输入，保留其在消息内部的原始位置。 */
export function ChatInbox({ part }: ChatInboxProps) {
  const preview = part.content.map(item => item.type === "text" ? item.text
    : item.type === "context" ? item.context : item.filename ?? "附件").join(" ").replace(/\s+/gu, " ").trim();
  return <details className="dc-chat-activity-row dc-chat-inbox-row">
    <summary className="dc-chat-activity-summary">
      <span className="dc-chat-activity-main">
        <Inbox />
        <span className="dc-chat-activity-state">运行时输入</span>
        <span className="dc-chat-activity-name">{preview || part.kind}</span>
        <TbChevronRight className="dc-chat-activity-chevron" />
      </span>
    </summary>
    <div className="dc-chat-activity-terminal">
      <pre>{part.kind}</pre>
      {part.content.map((item, index) => item.type === "file"
        ? <span className="dc-chat-attachment" key={index} title={item.url}><File />{item.filename ?? "附件"}</span>
        : <pre key={index}>{item.type === "context" ? `${item.tag}\n${item.context}` : item.text}</pre>)}
    </div>
  </details>;
}
