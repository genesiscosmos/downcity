/** Agent Message 中连续 Reasoning、Tool 与 Interaction 的活动展示。 */

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { RespondSessionInteractionInput, SessionAgentInteractionPart, SessionAgentReasoningPart, SessionAgentToolPart } from "@downcity/agent";
import { TbBulb, TbChevronRight, TbFilePencil, TbFilePlus, TbFileSearch, TbMessageQuestion, TbPuzzle, TbSearch, TbTerminal2, TbTextScan2 } from "react-icons/tb";
import { AgentInteraction, resolve_agent_interaction_title } from "@/features/chat/components/messages/AgentInteraction";
import { resolve_agent_tool_presentation, should_auto_open_agent_activity, should_force_open_agent_activity, should_force_open_agent_tool } from "@/features/chat/lib/message/agent_tool_presentation";
import type { AgentActivityPart, AgentToolVisualKind } from "@/features/chat/types/AgentMessage";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/**
 * 展示连续活动。Reasoning 显隐只改变可见项，不改变 canonical 活动块边界。
 * 零项不输出容器，一项直接显示，多项聚合为一个可展开日志。
 */
export function AgentActivity({ parts, show_reasoning, streaming, respond_interaction }: { parts: readonly AgentActivityPart[]; show_reasoning: boolean; streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const visible_parts = parts.filter((part) => part.type !== "reasoning" || (show_reasoning && Boolean(part.text.trim())));
  if (visible_parts.length === 0) return null;
  if (visible_parts.length === 1) return <div className="agent-process-body"><AgentActivityItem part={visible_parts[0]} message_streaming={streaming} respond_interaction={respond_interaction} /></div>;
  return <div className="agent-process-body"><AgentActivityGroup parts={visible_parts} message_streaming={streaming} respond_interaction={respond_interaction} /></div>;
}

/** 多个连续活动共用的折叠摘要与展开状态。摘要始终取最后一个非 Reasoning 项。 */
function AgentActivityGroup({ parts, message_streaming, respond_interaction }: { parts: readonly AgentActivityPart[]; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  const translate_chat = use_translation("chat");
  const [open, set_open] = useState(() => should_auto_open_agent_activity(parts));
  const summary_part = find_last_non_reasoning(parts) ?? parts[parts.length - 1];
  const force_open = should_force_open_agent_activity(parts);
  const auto_open = should_auto_open_agent_activity(parts);
  useEffect(() => set_open(auto_open), [auto_open, parts.find((part) => part.type === "interaction" && part.status === "pending")?.part_id]);

  const summary = activity_summary(summary_part, message_streaming, translate_chat);
  return <details open={force_open || open} onToggle={(event) => handle_details_toggle(event.currentTarget, force_open, set_open)} className={cn("activity-tool-row activity-tool-group", summary.state_class)}>
    <summary className="activity-tool-summary activity-tool-group-summary"><span className="activity-tool-main"><ActivityIcon visual_kind={summary.visual_kind} /><span className="activity-tool-state">{summary.state}</span><span className="activity-tool-name">{summary.detail}</span><span className="activity-tool-count">+{parts.length - 1}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    <div className="activity-tool-group-body">{parts.map((part, index) => <div key={part.part_id} className="activity-tool-log"><AgentActivityItem part={part} message_streaming={message_streaming && index === parts.length - 1} respond_interaction={respond_interaction} /></div>)}</div>
  </details>;
}

function activity_summary(part: AgentActivityPart, message_streaming: boolean, translate_chat: (key: string) => string): { detail: string; state: string; state_class: string; visual_kind?: AgentToolVisualKind } {
  if (part.type === "tool") {
    const presentation = resolve_agent_tool_presentation(part);
    return { detail: presentation.detail, state: translate_chat(presentation.state_key), state_class: presentation.running ? "is-running" : presentation.failed ? "is-failed" : "is-complete", visual_kind: presentation.visual_kind };
  }
  if (part.type === "interaction") {
    const waiting = part.status === "pending";
    const failed = part.status === "failed";
    return { detail: resolve_agent_interaction_title(part), state: translate_chat(waiting ? "activity.waiting_response" : failed ? "activity.failed" : "activity.completed"), state_class: waiting ? "is-waiting" : failed ? "is-failed" : "is-complete", visual_kind: "ask" };
  }
  const running = part.state === "streaming" || message_streaming;
  return { detail: reasoning_preview(part.text), state: translate_chat(running ? "activity.thinking" : "activity.thought"), state_class: running ? "is-running" : "is-complete" };
}

/** 对单个 canonical 活动 Part 做穷尽分发。 */
function AgentActivityItem({ part, message_streaming, respond_interaction }: { part: AgentActivityPart; message_streaming: boolean; respond_interaction(input: RespondSessionInteractionInput): Promise<void> }) {
  switch (part.type) {
    case "reasoning": return <AgentReasoning part={part} message_streaming={message_streaming} />;
    case "tool": return <AgentTool part={part} />;
    case "interaction": return <AgentInteraction part={part} respond={respond_interaction} />;
    default: return assert_never(part);
  }
}

/** 可展开的 Reasoning 活动行。 */
function AgentReasoning({ part, message_streaming }: { part: SessionAgentReasoningPart; message_streaming: boolean }) {
  const translate_chat = use_translation("chat");
  const running = part.state === "streaming" || message_streaming;
  const text = part.text.trim();
  if (!text) return null;
  return <details className={cn("activity-tool-row reasoning-activity-row", running ? "is-running" : "is-complete")}>
    <summary className="activity-tool-summary"><span className="activity-tool-main"><TbBulb className="activity-tool-icon" aria-hidden /><span className="activity-tool-state">{translate_chat(running ? "activity.thinking" : "activity.thought")}</span><span className="activity-tool-name">{reasoning_preview(text)}</span><TbChevronRight className="activity-tool-chevron" aria-hidden /></span></summary>
    <div className="reasoning-activity-content"><div className="reasoning-block">{text}</div></div>
  </details>;
}

/** Tool 生命周期、摘要以及按工具语义裁剪后的主要内容。 */
function AgentTool({ part }: { part: SessionAgentToolPart }) {
  const translate_chat = use_translation("chat");
  const [open, set_open] = useState(false);
  const presentation = resolve_agent_tool_presentation(part);
  const force_open = should_force_open_agent_tool(part);
  const details = render_tool_details(part, presentation.visual_kind);
  const class_name = cn("activity-tool-row activity-tool-item", presentation.running ? "is-running" : presentation.failed ? "is-failed" : "is-complete");
  const summary = <span className="activity-tool-main"><ActivityIcon visual_kind={presentation.visual_kind} /><span className="activity-tool-state">{translate_chat(presentation.state_key)}</span><span className="activity-tool-name">{presentation.detail}</span>{details ? <TbChevronRight className="activity-tool-chevron" aria-hidden /> : null}</span>;
  if (!details) return <div className={class_name}><div className="activity-tool-summary">{summary}</div></div>;
  return <details open={force_open || open} onToggle={(event) => handle_details_toggle(event.currentTarget, force_open, set_open)} className={class_name}>
    <summary className="activity-tool-summary">{summary}</summary>
    <div className={cn("activity-tool-detail", `is-${presentation.visual_kind}`)}>{details}</div>
  </details>;
}

/** 不再通用打印 JSON；每类 Tool 只展示完成任务所需的主要字段。 */
function render_tool_details(part: SessionAgentToolPart, visual_kind: AgentToolVisualKind): ReactNode {
  const input = object_value(part.input);
  const streaming = part.state === "input-streaming";
  if (visual_kind === "write") return code_body(string_field(input, ["content"]) || streamed_field(part.input_text, ["content"]), streaming);
  if (visual_kind === "edit") {
    const edits = Array.isArray(input?.edits) ? input.edits.map(object_value).filter((edit): edit is Record<string, unknown> => Boolean(edit)) : [];
    const pairs = edits.length
      ? edits.map((edit) => ({ old_text: string_field(edit, ["old_text"]), new_text: string_field(edit, ["new_text"]) }))
      : build_streamed_edit_pairs(input, part.input_text);
    return edit_diff_body(pairs, streaming);
  }
  if (visual_kind === "shell") {
    const command = string_field(input, ["cmd", "command", "input"]) || streamed_field(part.input_text, ["cmd", "command", "input"]);
    const output = primary_text(part.output, ["output", "text", "content", "message"]);
    return text_body([command ? `$ ${command}` : "", output, part.error || ""].filter(Boolean).join("\n"), "activity-tool-console", streaming);
  }
  if (visual_kind === "read") return text_body(primary_text(part.output, ["content", "text", "output"]) || string_field(input, ["file_path", "path"]) || streamed_field(part.input_text, ["file_path", "path"]), "activity-tool-content", streaming);
  if (visual_kind === "grep" || visual_kind === "find") return text_body(primary_text(part.output, ["matches", "files", "results", "output", "text"]) || string_field(input, ["query", "pattern", "glob", "path"]) || streamed_field(part.input_text, ["query", "pattern", "glob", "path"]), "activity-tool-content", streaming);
  if (visual_kind === "plugin") return text_body(primary_text(part.output, ["result", "output", "text", "message"]) || primary_text(input?.payload, ["text", "query", "name", "title"]) || string_field(input, ["action"]) || streamed_field(part.input_text, ["text", "query", "name", "title", "action"]), "activity-tool-content", streaming);
  return text_body(primary_text(part.output, ["result", "output", "text", "content", "message"]) || primary_text(part.input ?? part.input_text, ["text", "query", "prompt", "path"]), "activity-tool-content", streaming);
}

function edit_diff_body(pairs: readonly { old_text: string; new_text: string }[], streaming: boolean): ReactNode {
  if (pairs.length === 0) return null;
  return <div className="activity-tool-edit-diff">{pairs.map((pair, pair_index) => <div key={pair_index} className="activity-tool-edit-pair">
    {pair.old_text ? split_diff_lines(pair.old_text).map((line, line_index) => <pre key={`old:${line_index}`} className="activity-tool-diff-line is-removal"><code>{line || " "}</code></pre>) : null}
    {pair.new_text || (streaming && pair_index === pairs.length - 1) ? split_diff_lines(pair.new_text).map((line, line_index, lines) => <pre key={`new:${line_index}`} className="activity-tool-diff-line is-addition"><code>{line || " "}{streaming && pair_index === pairs.length - 1 && line_index === lines.length - 1 ? <span className="activity-tool-input-caret" aria-hidden /> : null}</code></pre>) : null}
  </div>)}</div>;
}
function split_diff_lines(text: string): string[] { return text.split("\n"); }
function build_streamed_edit_pairs(input: Record<string, unknown> | undefined, input_text: string | undefined): { old_text: string; new_text: string }[] {
  const direct_old = string_field(input, ["old_text"]);
  const direct_new = string_field(input, ["new_text"]);
  if (direct_old || direct_new) return [{ old_text: direct_old, new_text: direct_new }];
  const old_values = streamed_fields(input_text, "old_text");
  const new_values = streamed_fields(input_text, "new_text");
  const count = Math.max(old_values.length, new_values.length);
  return Array.from({ length: count }, (_, index) => ({ old_text: old_values[index] ?? "", new_text: new_values[index] ?? "" }));
}
function code_body(text: string, streaming: boolean): ReactNode { return text_body(text, "activity-tool-code", streaming); }
function text_body(text: string, class_name: string, streaming: boolean): ReactNode {
  if (!text) return null;
  return <pre className={class_name}>{text}{streaming ? <span className="activity-tool-input-caret" aria-hidden /> : null}</pre>;
}

/** 将结构化结果压缩为可读主内容，不泄露整段 JSON 外壳。 */
function primary_text(value: unknown, preferred_keys: readonly string[]): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => primary_text(item, preferred_keys)).filter(Boolean).join("\n");
  const record = object_value(value);
  if (!record) return "";
  for (const key of preferred_keys) {
    if (record[key] !== undefined) {
      const text = primary_text(record[key], preferred_keys);
      if (text) return text;
    }
  }
  return Object.values(record).filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean").map(String).join(" · ");
}

/** 活动类型图标。 */
function ActivityIcon({ visual_kind }: { visual_kind?: AgentToolVisualKind }) {
  const icons: Record<AgentToolVisualKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { read: TbTextScan2, write: TbFilePlus, edit: TbFilePencil, grep: TbSearch, find: TbFileSearch, shell: TbTerminal2, ask: TbMessageQuestion, plugin: TbPuzzle, generic: TbPuzzle };
  const Icon = visual_kind ? icons[visual_kind] : TbBulb;
  return <Icon className="activity-tool-icon" aria-hidden />;
}

function object_value(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function string_field(record: Record<string, unknown> | undefined, keys: readonly string[]): string { if (!record) return ""; for (const key of keys) { const value = record[key]; if (typeof value === "string" && value.trim()) return value; } return ""; }
function streamed_field(input_text: string | undefined, keys: readonly string[]): string { for (const key of keys) { const value = streamed_fields(input_text, key)[0]; if (value) return value; } return ""; }
function streamed_fields(input_text: string | undefined, key: string): string[] {
  if (!input_text) return [];
  const values: string[] = [];
  const marker = `"${key}"`;
  let cursor = 0;
  while ((cursor = input_text.indexOf(marker, cursor)) >= 0) {
    cursor += marker.length;
    const match = input_text.slice(cursor).match(/^\s*:\s*"/);
    if (!match) continue;
    cursor += match[0].length;
    let raw = "";
    let escaped = false;
    for (; cursor < input_text.length; cursor += 1) {
      const character = input_text[cursor];
      if (!escaped && character === '"') break;
      raw += character;
      if (character === "\\" && !escaped) escaped = true;
      else escaped = false;
    }
    values.push(decode_json_fragment(raw));
  }
  return values;
}
function decode_json_fragment(raw: string): string { try { return JSON.parse(`"${raw.replace(/\\$/g, "")}"`) as string; } catch { return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\"); } }
function reasoning_preview(text: string): string { return text.replace(/\s+/g, " ").trim(); }
function find_last_non_reasoning(parts: readonly AgentActivityPart[]): SessionAgentToolPart | SessionAgentInteractionPart | undefined { for (let index = parts.length - 1; index >= 0; index -= 1) { const part = parts[index]; if (part?.type === "tool" || part?.type === "interaction") return part; } return undefined; }
function handle_details_toggle(details: HTMLDetailsElement, force_open: boolean, set_open: (open: boolean) => void): void { if (force_open) { if (!details.open) details.open = true; return; } set_open(details.open); }
function assert_never(value: never): never { throw new Error(`不支持的 Agent Activity Part：${String((value as { type?: unknown }).type)}`); }
