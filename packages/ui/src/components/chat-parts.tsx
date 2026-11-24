/** 默认消息部件：顺序、活动与交互展示由消息组件和 ChatPanel 共同消费。 */
import { type ReactNode } from "react";
import { ChevronDown, File } from "lucide-react";
import { use_control_translation } from "../lib/control-messages";
import { AgentActivity } from "./agent-activity";
import { chat_activity_part } from "../lib/chat-activity";
import type { AgentActivityPart } from "../types/chat-blocks";
import { MarkdownView } from "./markdown/MarkdownView";
import type { DowncityChatChangedFile, DowncityChatContentPart, DowncityChatMessagePart, DowncityChatPanelProps, DowncityChatQuestion } from "../types/chat";
function format_value(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function ChangedFiles({ files = [] }: { files?: DowncityChatChangedFile[] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  if (!files.length) return null;
  return <details className="dc-chat-changed-files" open><summary><span>已更改 {files.length} 个文件</span><b>+{additions}</b><em>-{deletions}</em><ChevronDown /></summary><div>{files.map((file) => <details key={file.path}><summary><File /><span>{file.path}</span><b>+{file.additions}</b><em>-{file.deletions}</em></summary>{file.diff ? <pre>{file.diff}</pre> : null}</details>)}</div></details>;
}

function render_part(part: DowncityChatMessagePart, on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"], streaming = false): ReactNode {
  if (part.type === "input") return <AgentActivity parts={[chat_activity_part(part, 0)!]} />;
  if (part.type === "text") return <MarkdownView text={part.text ?? ""} mode={streaming && part.state === "streaming" ? "streaming" : "static"} layout="embedded" />;
  if (part.type === "reasoning" || part.type === "tool") return <AgentActivity parts={[chat_activity_part(part, 0)!]} />;
  if (part.type === "interaction") return <InteractionHistory part={part} />;
  if (part.type === "changed-files") return <ChangedFiles files={part.files} />;
  if (part.type === "operation") return <AgentActivity parts={[chat_activity_part(part, 0)!]} />;
  if (part.type === "file") return <a className="dc-chat-attachment" href={part.url} target="_blank" rel="noreferrer"><File />{part.filename ?? "附件"}</a>;
  if (part.type === "data" && part.data_type && ["reference", "task_result", "file-reference", "session-reference"].includes(part.data_type)) return <details className="text-xs"><summary>{part.data_type}</summary><pre className="whitespace-pre-wrap">{format_value(part.data)}</pre></details>;
  if (part.type === "source") return <a className="dc-chat-source" href={part.source_url} target="_blank" rel="noreferrer">{part.source_title ?? part.source_url}</a>;
  return null;
}

/** 交互只显示历史状态；唯一可操作表单位于输入框上方的 StatusPanel。 */
function InteractionHistory({ part }: { /** 只读的交互状态投影。 */ part: DowncityChatContentPart }) {
  const translate = use_control_translation("chat");
  return <p className="text-xs text-muted-foreground">{part.title} · {translate(`interaction.${part.interaction_status ?? "pending"}`)}</p>;
}

/** 连续活动交给完整 Activity；交互附属记录不打断工具分组，也不复制操作表单。 */
export function render_message_parts(parts: DowncityChatMessagePart[], on_respond_interaction?: DowncityChatPanelProps["on_respond_interaction"], render_interaction?: DowncityChatPanelProps["render_interaction"], streaming = false): ReactNode[] {
  const nodes: ReactNode[] = [];
  let activity: AgentActivityPart[] = [];
  const flush_activity = () => {
    if (!activity.length) return;
    nodes.push(<AgentActivity parts={activity} key={`activity-${activity[0].part_id}`} />);
    activity = [];
  };
  for (const [index, part] of parts.entries()) {
    if (part.type === "step-start") continue;
    if (part.type === "interaction" && part.interaction_tool_call_id && parts.some(item => item.type === "tool" && item.tool_call_id === part.interaction_tool_call_id)) continue;
    const canonical = chat_activity_part(part, index);
    if (canonical) activity.push(canonical);
    else { flush_activity(); nodes.push(<div className="dc-chat-part" key={part.id}>{render_part(part, on_respond_interaction, render_interaction, streaming)}</div>); }
  }
  flush_activity();
  return nodes;
}
