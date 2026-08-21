/**
 * Assistant canonical part 的展示分组与工具语义映射。
 *
 * 该模块只处理纯数据规则，确保 Renderer 不依赖组件状态判断消息顺序、活动聚合与操作栏可见性。
 */

import type { SessionAssistantMessagePart } from "@downcity/agent";

/** Canonical 文本接口同时承载 text 与 reasoning，展示层将两者收窄为明确类型。 */
type AssistantTextualPart = Extract<SessionAssistantMessagePart, { type: "text" | "reasoning" }>;

/** 展示层使用的 Reasoning part。 */
export type AssistantReasoningPart = AssistantTextualPart & { /** part 类型固定为 reasoning。 */ type: "reasoning" };

/** 展示层使用的普通文本 part。 */
export type AssistantTextPart = AssistantTextualPart & { /** part 类型固定为 text。 */ type: "text" };

/** Reasoning、Tool 与 Interaction 构成 Assistant 活动流。 */
export type AssistantActivityPart =
  | AssistantReasoningPart
  | Extract<SessionAssistantMessagePart, { type: "tool" | "interaction" }>;

/** 不属于活动流、可以独立渲染的 canonical part。 */
type AssistantStandalonePart =
  | AssistantTextPart
  | Exclude<SessionAssistantMessagePart, AssistantTextualPart | Extract<SessionAssistantMessagePart, { type: "tool" | "interaction" }>>;

/** 页面按原始生成顺序渲染的顶层内容分组。 */
export type AssistantContentGroup =
  | { /** 连续活动块。 */ type: "activity"; /** 块内活动 part。 */ parts: AssistantActivityPart[] }
  | { /** 独立可见 part。 */ type: "part"; /** 原始 canonical part。 */ part: AssistantStandalonePart };

/** 活动块内部的可折叠项分组。 */
export type AssistantActivityGroup =
  | { /** 单独渲染的活动。 */ type: "single"; /** 单个活动 part。 */ part: AssistantActivityPart }
  | { /** 连续活动的聚合项。 */ type: "group"; /** 聚合后的活动 part，包含内联 Interaction。 */ parts: AssistantActivityPart[] };

/** Tool 的视觉语义。 */
export type AssistantToolVisualKind = "read" | "write" | "edit" | "grep" | "find" | "shell" | "ask" | "plugin" | "generic";

/** Tool 活动行所需的稳定展示信息。 */
export interface AssistantToolPresentation {
  /** Tool 对应的视觉类型。 */
  visual_kind: AssistantToolVisualKind;
  /** 当前生命周期的用户可见状态。 */
  state_label: string;
  /** Tool 操作的单行摘要。 */
  detail: string;
  /** Tool 是否仍在运行。 */
  running: boolean;
  /** Tool 是否失败。 */
  failed: boolean;
}

/** 保留 canonical 顺序，把连续活动 part 合并为活动块。 */
export function group_assistant_content(parts: SessionAssistantMessagePart[]): AssistantContentGroup[] {
  const groups: AssistantContentGroup[] = [];
  for (const part of parts) {
    // 无展示语义的 part 不能切断连续 Tool 活动。
    if (part.type === "step-start" || part.type === "data") continue;
    if (part.type === "text" && !part.text.trim()) continue;
    if (is_activity_part(part)) {
      const previous = groups[groups.length - 1];
      if (previous?.type === "activity") previous.parts.push(part);
      else groups.push({ type: "activity", parts: [part] });
      continue;
    }
    groups.push({ type: "part", part: part as AssistantStandalonePart });
  }
  return groups;
}

/** 聚合连续活动，Interaction 与对应 Tool 保持在同一折叠块内。 */
export function group_assistant_activities(parts: AssistantActivityPart[], show_reasoning: boolean): AssistantActivityGroup[] {
  const visible = parts.filter((part) => part.type !== "reasoning" || (show_reasoning && Boolean(part.text.trim())));
  if (visible.length === 0) return [];
  if (visible.length === 1) return [{ type: "single", part: visible[0] }];
  return [{ type: "group", parts: visible }];
}

/** Assistant 操作栏只在最后一个具有展示语义的 part 是非空文本时出现。 */
export function should_show_assistant_actions(parts: SessionAssistantMessagePart[]): boolean {
  const visible = parts.filter((part) => {
    if (part.type === "step-start" || part.type === "data") return false;
    if (part.type === "text") return Boolean(part.text.trim());
    return true;
  });
  return visible[visible.length - 1]?.type === "text";
}

/** 将 canonical Tool 映射为稳定的 Duobox 风格展示语义。 */
export function resolve_tool_presentation(part: Extract<SessionAssistantMessagePart, { type: "tool" }>): AssistantToolPresentation {
  const visual_kind = resolve_tool_visual_kind(part.tool_name);
  const running = part.state === "input-streaming" || part.state === "ready" || part.state === "running";
  const failed = part.state === "failed";
  return {
    visual_kind,
    state_label: resolve_tool_state_label(visual_kind, part.state),
    detail: resolve_tool_detail(part, visual_kind),
    running,
    failed,
  };
}

/** 写入或编辑参数仍在流式生成时，详情必须保持展开以展示实时代码变化。 */
export function should_force_open_tool(part: Extract<SessionAssistantMessagePart, { type: "tool" }>): boolean {
  if (part.state !== "input-streaming") return false;
  const visual_kind = resolve_tool_visual_kind(part.tool_name);
  return visual_kind === "write" || visual_kind === "edit";
}

/** 流式代码预览存在时，活动组必须保持展开。 */
export function should_force_open_activity_group(parts: AssistantActivityPart[]): boolean {
  return parts.some((part) => part.type === "tool" && should_force_open_tool(part));
}

/** 待响应 Interaction 出现时，活动组应自动展开一次。 */
export function should_auto_open_activity_group(parts: AssistantActivityPart[]): boolean {
  return parts.some((part) => part.type === "interaction" && part.status === "pending");
}

/** 从常见结构化输入中读取第一个非空字符串。 */
export function read_tool_input_text(input: unknown, keys: string[]): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function is_activity_part(part: SessionAssistantMessagePart): part is AssistantActivityPart {
  return part.type === "reasoning" || part.type === "tool" || part.type === "interaction";
}

function resolve_tool_visual_kind(tool_name: string): AssistantToolVisualKind {
  const normalized = tool_name.toLowerCase();
  if (normalized === "read" || normalized.endsWith("_read")) return "read";
  if (normalized === "write" || normalized.endsWith("_write")) return "write";
  if (normalized === "edit" || normalized.endsWith("_edit")) return "edit";
  if (normalized === "grep" || normalized.includes("search")) return "grep";
  if (normalized === "find" || normalized.includes("glob")) return "find";
  if (normalized === "shell_exec" || normalized === "shell_session" || normalized.includes("terminal")) return "shell";
  if (normalized === "ask_question" || normalized.includes("question")) return "ask";
  if (normalized === "plugin_call" || normalized.startsWith("plugin_")) return "plugin";
  return "generic";
}

function resolve_tool_state_label(visual_kind: AssistantToolVisualKind, state: Extract<SessionAssistantMessagePart, { type: "tool" }>["state"]): string {
  if (state === "waiting-user") return "等待确认";
  const labels: Record<AssistantToolVisualKind, [string, string, string]> = {
    read: ["正在读取", "已读取", "读取失败"],
    write: ["正在写入", "已写入", "写入失败"],
    edit: ["正在编辑", "已编辑", "编辑失败"],
    grep: ["正在搜索", "已搜索", "搜索失败"],
    find: ["正在查找", "已查找", "查找失败"],
    shell: ["正在执行", "已执行", "执行失败"],
    ask: ["正在提问", "已提问", "提问失败"],
    plugin: ["正在调用", "已调用", "调用失败"],
    generic: ["正在执行", "已完成", "执行失败"],
  };
  const [running, completed, failed] = labels[visual_kind];
  return state === "failed" ? failed : state === "completed" ? completed : running;
}

function resolve_tool_detail(part: Extract<SessionAssistantMessagePart, { type: "tool" }>, visual_kind: AssistantToolVisualKind): string {
  const input = part.input ?? part.raw_input;
  if (visual_kind === "read" || visual_kind === "write" || visual_kind === "edit") {
    return read_tool_input_text(input, ["file_path", "path", "filename"]) || part.title || part.tool_name;
  }
  if (visual_kind === "grep") return read_tool_input_text(input, ["pattern", "query", "text"]) || part.title || part.tool_name;
  if (visual_kind === "find") return read_tool_input_text(input, ["pattern", "glob", "path"]) || part.title || part.tool_name;
  if (visual_kind === "shell") {
    const action = read_tool_input_text(input, ["action"]);
    const command = read_tool_input_text(input, ["cmd", "command", "input"]);
    return [action, command].filter(Boolean).join(" · ") || part.title || part.tool_name;
  }
  if (visual_kind === "plugin") {
    const plugin = read_tool_input_text(input, ["plugin", "plugin_id"]);
    const action = read_tool_input_text(input, ["action", "action_name"]);
    return [plugin, action].filter(Boolean).join(" · ") || part.title || part.tool_name;
  }
  return part.title || part.tool_name;
}
