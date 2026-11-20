/**
 * Session Power 的只读 activity：会话快照、工作指令、消息、历史 Part 与待响应事项。
 * 所有事实只来自本次 tool.output.data；不查询实时状态，不提供回复、批准或控制按钮。
 * 折叠阶段只判断业务字段是否存在，正文归一化与格式化在展开时进行。
 */
import { createElement as create_element, type ReactNode } from "react";
import type { PowerActivityProps, PowerActivityRenderer, PowerActivityDescription } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, preparing_description, record_items, record_value, short_text, text_value } from "./Activity.js";

/** Session 自有中英文动作名称。 */
const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "start": {
    running: ["正在提交工作", "Submitting work"],
    waiting: ["工作提交等待确认", "Work submission awaiting confirmation"],
    complete: ["工作已提交", "Work submitted"],
    failed: ["工作提交失败", "Work submission failed"],
  },
  "input": {
    running: ["正在输入工作要求", "Providing work input"],
    waiting: ["追加指令等待确认", "Instructions awaiting confirmation"],
    complete: ["会话已接收输入", "Session input accepted"],
    failed: ["工作指令提交失败", "Instructions submission failed"],
  },
  "check": {
    running: ["正在查看会话", "Inspecting sessions"],
    waiting: ["会话查询等待确认", "Session query awaiting confirmation"],
    complete: ["已查看会话", "Sessions inspected"],
    failed: ["会话查询失败", "Session query failed"],
  },
  "messages": {
    running: ["正在读取会话历史", "Reading session history"],
    waiting: ["历史读取等待确认", "History read awaiting confirmation"],
    complete: ["已读取会话历史", "Session history read"],
    failed: ["会话历史读取失败", "History read failed"],
  },
  "part": {
    running: ["正在读取消息内容", "Reading message content"],
    waiting: ["消息读取等待确认", "Message read awaiting confirmation"],
    complete: ["已读取消息内容", "Message content read"],
    failed: ["消息内容读取失败", "Message read failed"],
  },
  "archive": {
    running: ["正在归档会话", "Archiving session"],
    waiting: ["会话归档等待确认", "Archive awaiting confirmation"],
    complete: ["会话已归档", "Session archived"],
    failed: ["会话归档失败", "Session archive failed"],
  },
  "reply": {
    running: ["正在回复工作问题", "Answering work question"],
    waiting: ["问题回复等待确认", "Answer awaiting confirmation"],
    complete: ["工作问题已回复", "Work question answered"],
    failed: ["工作问题回复失败", "Answer submission failed"],
  },
  "stop": {
    running: ["正在请求停止工作", "Requesting work stop"],
    waiting: ["停止工作等待确认", "Work stop awaiting confirmation"],
    complete: ["已请求停止工作", "Work stop requested"],
    failed: ["停止工作请求失败", "Work stop request failed"],
  },
  "": {
    running: ["正在读取 Session 动作", "Reading Session actions"],
    waiting: ["Session 操作等待确认", "Session operation awaiting confirmation"],
    complete: ["已读取 Session 动作", "Session actions read"],
    failed: ["Session 操作失败", "Session operation failed"],
  },
};

/** 快照状态只描述目标当时的状态，idle 不代表工作成功。 */
const state_labels: Readonly<Record<string, readonly [string, string]>> = {
  running: ["运行中", "Running"], waiting_for_user: ["等待用户", "Waiting for user"],
  idle: ["空闲", "Idle"], started: ["已启动", "Started"], stopped: ["已停止", "Stopped"],
  resolved: ["已响应", "Resolved"], denied: ["已拒绝", "Denied"], submitted: ["已提交", "Submitted"],
};

/** 仅检查可读的会话事实，只有技术标识的结果不可展开。 */
function has_session(value: unknown): boolean {
  const session = record_value(value);
  return Boolean(text_value(session.title) || text_value(session.preview_text));
}

/** 仅展示可读回复说明；未知 payload 不序列化。 */
function has_response(props: PowerActivityProps): boolean {
  return action_id(props) === "reply" && Boolean(text_value(input_args(props).note));
}

/** 读取 canonical history 的明确有界预览信封；不递归扫描任意工具内容。 */
function history_part_text(value: unknown): string {
  let preview = record_value(record_value(value).preview);
  if (preview.view === "bounded_preview") preview = record_value(preview.preview);
  if (preview.view === "object_preview") preview = record_value(preview.fields);
  const text = preview.text;
  return typeof text === "string" ? text : record_value(text).view === "text_preview" ? text_value(record_value(text).text) : "";
}

/** 历史片段需要实际正文；纯工具参数、ID 与元数据不进入详情。 */
function has_part_text(value: unknown): boolean {
  return Boolean(history_part_text(value));
}

/** 判断受限历史页是否有正文，不扫描整份历史。 */
function has_history_text(data: Record<string, unknown>): boolean {
  if (data.view === "field_text") return data.encoding === "text" && data.field === "text" && Boolean(text_value(data.text));
  return record_items(data.items).some(item => data.view === "part_preview" ? has_part_text(item) : record_items(item.parts).some(has_part_text));
}

/** 描述只挑选标题和稳定目标；不展开 JSON、消息正文或完整历史。 */
function describe_session(props: PowerActivityProps): PowerActivityDescription {
  const preparing = preparing_description(props, "Session");
  if (preparing) return preparing;
  const args = input_args(props);
  const data = output_data(props);
  const target = record_value(data.session);
  const action = action_id(props);
  const chinese = is_chinese(props.locale);
  const tone = activity_tone(props);
  const title = action_sentences[action]?.[tone] ?? action_sentences[""]![tone];
  const is_list = action === "check" && !text_value(args.session_id);
  const has_messages = record_items(data.messages).some(item => text_value(item.text));
  const has_pending = record_items(data.pending_interactions).some(item => text_value(item.title) || text_value(item.description));
  const count = Array.isArray(data.sessions) ? data.sessions.length : undefined;
  return {
    title: title[chinese ? 0 : 1],
    summary: is_list && count !== undefined ? (chinese ? `${count} 个会话` : `${count} ${count === 1 ? "session" : "sessions"}`) : short_text(target.title) || short_text(args.title),
    tone,
    has_detail: !is_list && Boolean(text_value(args.query) || has_response(props) || has_session(data.session)
      || has_messages || has_history_text(data) || has_pending || text_value(data.failure) || failure_text(props)),
  };
}

/** 安全正文：作为 React 文本显示，长文本只在展开后截取。 */
function text_block(text: string, mono = false): ReactNode {
  return create_element("pre", {
    className: `max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs ${mono ? "font-mono" : "font-sans"}`,
  }, text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
}

/** 独立语义段落，不附加空占位区域。 */
function section(title: string, children: ReactNode): ReactNode {
  return create_element("section", { className: "space-y-2" }, create_element("p", { className: "font-medium" }, title), children);
}

/** 展示单条会话的事实与快照状态。 */
function session_snapshot(session: Record<string, unknown>, chinese: boolean, index: number): ReactNode {
  const state = text_value(session.state) || text_value(session.status);
  const state_label = state_labels[state]?.[chinese ? 0 : 1] || state;
  const count = session.pending_interaction_count;
  return create_element("article", { key: `${text_value(session.session_id)}:${index}`, className: "space-y-1 border-l border-border pl-2" },
    create_element("p", { className: "font-medium" }, short_text(session.title) || (chinese ? "未命名会话" : "Untitled session")),
    state_label ? create_element("p", { className: "text-muted-foreground" }, state_label) : null,
    text_value(session.preview_text) ? text_block(text_value(session.preview_text)) : null,
    typeof count === "number" && Number.isFinite(count) && count > 0 ? create_element("p", { className: "text-muted-foreground" }, chinese ? `${count} 个待响应事项` : `${count} pending ${count === 1 ? "interaction" : "interactions"}`) : null);
}

/** 历史正文仅展示可读文本，不显示片段、消息标识与工具 JSON。 */
function history_detail(data: Record<string, unknown>, chinese: boolean): ReactNode {
  if (!has_history_text(data)) return null;
  if (data.view === "field_text") return section(chinese ? "消息内容" : "Message content", text_block(text_value(data.text)));
  const parts = record_items(data.items).flatMap(item => data.view === "part_preview" ? [item] : record_items(item.parts));
  const texts = parts.filter(has_part_text).slice(0, 12);
  return section(chinese ? "历史预览" : "History preview", create_element("div", { className: "space-y-3" },
    ...texts.map((part, index) => create_element("div", { key: index }, text_block(history_part_text(part)))),
    data.has_more === true || data.truncated === true || parts.length > 12 ? create_element("p", { className: "text-muted-foreground" }, chinese ? "仅显示部分内容" : "Showing partial content") : null));
}

/** Session 专用按需正文，不导入 Desktop 翻译、类型或组件。 */
function session_detail(props: PowerActivityProps) {
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const sessions = has_session(data.session) ? [record_value(data.session)] : [];
  const messages = record_items(data.messages).filter(message => text_value(message.text));
  const pending = record_items(data.pending_interactions).filter(item => text_value(item.title) || text_value(item.description));
  const response = has_response(props) ? text_value(args.note) : "";
  const failure = failure_text(props) || text_value(data.failure);
  return create_element("div", { className: "space-y-3 p-3 text-xs leading-relaxed" },
    sessions.length ? section(chinese ? "会话快照" : "Session snapshot", sessions.map((session, index) => session_snapshot(session, chinese, index))) : null,
    text_value(args.query) ? section(chinese ? "工作指令" : "Instruction", text_block(text_value(args.query))) : null,
    response ? section(chinese ? "回复内容" : "Response", text_block(response)) : null,
    messages.length ? section(chinese ? "最近消息" : "Recent messages", messages.map((message, index) => create_element("div", { key: index, className: "space-y-1 border-l border-border pl-2" },
      create_element("p", { className: "text-muted-foreground" }, text_value(message.role) === "user" ? (chinese ? "用户" : "User") : text_value(message.role) === "agent" ? "Agent" : text_value(message.role)),
      text_block(text_value(message.text))))) : null,
    history_detail(data, chinese),
    pending.length ? section(chinese ? "待响应事项" : "Pending interactions", pending.map((item, index) => create_element("div", { key: index, className: "space-y-1 border-l border-border pl-2" },
      text_value(item.title) ? create_element("p", { className: "font-medium" }, short_text(item.title)) : null,
      text_value(item.description) ? text_block(text_value(item.description)) : null))) : null,
    failure ? section(chinese ? "失败信息" : "Failure", create_element("div", { className: "text-destructive" }, text_block(failure))) : null);
}

/** Session 自有 activity 插槽。 */
export const SESSION_ACTIVITY_RENDERER: PowerActivityRenderer = { describe: describe_session, detail: session_detail };
