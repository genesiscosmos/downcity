/**
 * Agent 活动（Reasoning / Tool / Action）canonical 状态到展示语义的唯一映射。
 *
 * 关键点（中文）
 * - Tool 的种类判断、生命周期文案、单行摘要与展开详情都在这里定义一次；组件只渲染结果，
 *   不按 Tool 名称分支。Action 共用同一套结果结构，按 action_type 识别种类。
 * - 输入读取只有一条规则：结构化参数优先，未收口时回退到流式原文。摘要与详情共用它，
 *   因此不会出现「摘要读结构化、详情猜 JSON」这类两套口径。
 * - 本模块是纯函数，不依赖 React；组件负责 DOM、图标与交互。
 */

import type { SessionAgentActionPart, SessionAgentToolPart } from "@downcity/agent";
import type {
  AgentActionVisualKind,
  AgentActivityDetail,
  AgentActivityEditPair,
  AgentActivityPart,
  AgentActivityPresentation,
  AgentActivityTone,
  AgentToolVisualKind,
} from "@/features/chat/types/AgentMessage";

/** 输入字段的候选名，按优先级排列。 */
type FieldNames = readonly string[];

/** 一个视觉种类需要的全部展示规则。 */
interface AgentToolRule {
  /** `input-streaming` 时是否自动展开一次；只有会产生大段输入的写入类 Tool 需要。 */
  auto_open_while_streaming: boolean;
  /** 活动行单行摘要。 */
  summary(part: SessionAgentToolPart): string;
  /** 展开详情；null 表示没有可展开内容。 */
  detail(part: SessionAgentToolPart): AgentActivityDetail | null;
}

/** 没有专用展示协议的 Tool：标题即摘要，输出正文即可展开内容。 */
const plain_tool_rule: AgentToolRule = {
  auto_open_while_streaming: false,
  summary: (part) => part.title || part.tool_name,
  detail: (part) => code_detail(read_output(part, ["result", "output", "text", "content", "message"]) || read_input(part, ["text", "query", "prompt", "path"])),
};

/** 每个视觉种类的展示规则；新增种类时由类型系统强制补全。 */
const AGENT_TOOL_RULES: Record<AgentToolVisualKind, AgentToolRule> = {
  read: {
    auto_open_while_streaming: false,
    summary: (part) => file_summary(part),
    detail: (part) => code_detail(read_output(part, ["content", "text", "output"]) || read_input(part, ["file_path", "path"])),
  },
  write: {
    auto_open_while_streaming: true,
    summary: (part) => file_summary(part),
    detail: (part) => code_detail(read_input(part, ["content"])),
  },
  edit: {
    auto_open_while_streaming: true,
    summary: (part) => file_summary(part),
    detail: (part) => {
      const pairs = edit_pairs(part);
      return pairs.length > 0 ? { type: "edit", pairs } : null;
    },
  },
  grep: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([read_input(part, ["pattern", "query", "text"]), part.title, part.tool_name]),
    detail: (part) => code_detail(read_output(part, ["matches", "files", "results", "output", "text"]) || read_input(part, ["query", "pattern", "glob", "path"])),
  },
  find: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([read_input(part, ["pattern", "glob", "path"]), part.title, part.tool_name]),
    detail: (part) => code_detail(read_output(part, ["files", "matches", "results", "output", "text"]) || read_input(part, ["glob", "pattern", "path"])),
  },
  shell: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([join_text([read_input(part, ["action"]), read_input(part, ["cmd", "command", "input"])]), part.title, part.tool_name]),
    detail: (part) => console_detail(part),
  },
  ask: plain_tool_rule,
  power: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([join_text([part.tool_name, read_input(part, ["action"])]), part.title]),
    // power 的参数在 `args` 内，是唯一需要读一层嵌套输入的种类。
    detail: (part) => code_detail(read_output(part, ["result", "output", "text", "message"])
      || read_input(part, ["action"])
      || pick_text(object_value(part.input)?.["args"], ["text", "query", "name", "title", "path", "url"])),
  },
  generic: plain_tool_rule,
};

/** 将 canonical Tool 映射为图标种类、生命周期文案、语气、摘要与展开详情。 */
export function resolve_agent_tool_presentation(part: SessionAgentToolPart): AgentActivityPresentation {
  const visual_kind = resolve_agent_tool_visual_kind(part);
  const rule = AGENT_TOOL_RULES[visual_kind];
  return {
    visual_kind,
    state_key: resolve_tool_state_key(visual_kind, part.state),
    tone: resolve_tool_tone(part.state),
    summary: rule.summary(part),
    detail: rule.detail(part),
    error: part.error?.trim() ?? "",
    input_streaming: part.state === "input-streaming",
  };
}

/**
 * 将 canonical Session Action 映射为图标种类、生命周期文案、语气、摘要与展开详情。
 *
 * Action 与 Tool 的差别集中在两点：种类按 `action_type` 识别，没有输入流式的中间态。
 * `description` 按语义分流：失败的 Action 把它当作错误原因，其余情况当作展开详情。
 */
export function resolve_agent_action_presentation(part: SessionAgentActionPart): AgentActivityPresentation {
  const failed = part.state === "failed";
  const description = part.description?.trim() ?? "";
  const detail_text = [failed ? "" : description, compact_text(part.data)].filter(Boolean).join("\n");
  return {
    visual_kind: resolve_agent_action_visual_kind(part.action_type),
    // Action 的生命周期已经是 canonical 终态词汇，不经过 Tool 的六态收敛。
    state_key: `activity.action.${part.state}`,
    tone: resolve_action_tone(part.state),
    summary: part.title.trim() || part.action_type,
    detail: code_detail(detail_text),
    error: failed ? description : "",
    input_streaming: false,
  };
}

/** 根据 Action 业务类别识别稳定视觉种类。 */
function resolve_agent_action_visual_kind(action_type: string): AgentActionVisualKind {
  const normalized = action_type.toLowerCase();
  if (normalized.includes("fork")) return "fork";
  if (normalized.includes("compact")) return "compaction";
  if (normalized.includes("command")) return "command";
  return "generic";
}

/** 将 Action 生命周期收敛为活动行语气；`completed` 与 `complete` 不是同一个词。 */
function resolve_action_tone(state: SessionAgentActionPart["state"]): AgentActivityTone {
  if (state === "failed") return "failed";
  return state === "completed" ? "complete" : "running";
}

/** Write 与 Edit 开始接收输入时自动展开一次；之后仍允许用户手动折叠。 */
export function should_auto_open_agent_tool(part: SessionAgentToolPart): boolean {
  return part.state === "input-streaming" && AGENT_TOOL_RULES[resolve_agent_tool_visual_kind(part)].auto_open_while_streaming;
}

/** 流式文件内容或待响应交互出现时，活动组自动展开一次但不锁定。 */
export function should_auto_open_agent_activity(parts: readonly AgentActivityPart[]): boolean {
  return parts.some((part) => part.type === "tool"
    && (should_auto_open_agent_tool(part) || (part.interactions ?? []).some((interaction) => interaction.status === "pending")));
}

/**
 * 活动组折叠摘要选中的 Part。
 *
 * Reasoning 只是过程说明，不是一次具体操作；Tool 与 Action 都是操作，因此两者一视同仁，
 * 摘要反映最后发生的那一件事。全部为 Reasoning 时回退到最后一项；空数组返回 undefined，
 * 调用方只在成组时使用它，组内至少有一项。
 */
export function select_activity_summary_part(parts: readonly AgentActivityPart[]): AgentActivityPart | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part && part.type !== "reasoning") return part;
  }
  return parts[parts.length - 1];
}

/**
 * 读取 Tool 输入原文中指定字段已经到达的字符串值。
 *
 * Tool 输入原文是模型逐段输出的 JSON 片段，收口前无法整体解析。这里做一次 JSON 字符串词法
 * 扫描：只有紧跟在字段名之后的值才会命中，因此字段名出现在别的文本内容里不会误配；尚未闭合
 * 的值按当前进度返回。同一个字段可以出现多次（例如 edits 数组），按出现顺序全部返回。
 */
export function read_streaming_input_values(input_text: string | undefined, field: string): string[] {
  if (!input_text) return [];
  const values: string[] = [];
  let index = 0;
  while (index < input_text.length) {
    if (input_text[index] !== "\"") {
      index += 1;
      continue;
    }
    const name = read_json_string(input_text, index);
    const colon = skip_whitespace(input_text, name.end);
    if (input_text[colon] !== ":") {
      index = name.end;
      continue;
    }
    const value_start = skip_whitespace(input_text, colon + 1);
    if (input_text[value_start] !== "\"") {
      index = colon + 1;
      continue;
    }
    const value = read_json_string(input_text, value_start);
    index = value.end;
    if (name.text === field) values.push(value.text);
  }
  return values;
}

/** 从 `start` 处的引号读取一个 JSON 字符串；允许尚未闭合。 */
function read_json_string(input_text: string, start: number): { text: string; end: number } {
  let raw = "";
  for (let index = start + 1; index < input_text.length; index += 1) {
    const character = input_text[index];
    if (character === "\\") {
      raw += character + (input_text[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "\"") return { text: decode_json_string(raw), end: index + 1 };
    raw += character;
  }
  return { text: decode_json_string(raw), end: input_text.length };
}

/** 解码 JSON 字符串内容；片段尚未闭合时退回原文，保证预览始终可读。 */
function decode_json_string(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/** 跳过空白字符。 */
function skip_whitespace(input_text: string, start: number): number {
  let index = start;
  while (index < input_text.length && /\s/.test(input_text[index])) index += 1;
  return index;
}

/**
 * 读取 Tool 输入字段。
 *
 * Tool 收口后 `input` 是模型给出的结构化参数；收口前只有逐段到达的 JSON 原文，此时按同一组
 * 字段名从原文里读取已经到达的值。摘要与详情因此共享同一条读取规则。
 */
function read_input(part: SessionAgentToolPart, fields: FieldNames): string {
  const structured = pick_text(part.input, fields);
  if (structured) return structured;
  if (part.state !== "input-streaming") return "";
  for (const field of fields) {
    const [streamed] = read_streaming_input_values(part.input_text, field);
    if (streamed) return streamed;
  }
  return "";
}

/** 读取 Tool 输出正文；没有稳定字段时回退为紧凑结构化文本。 */
function read_output(part: SessionAgentToolPart, fields: FieldNames): string {
  return pick_text(part.output, fields) || compact_text(part.output);
}

/** 文件类 Tool 的摘要：目标文件路径。 */
function file_summary(part: SessionAgentToolPart): string {
  return first_text([read_input(part, ["file_path", "path", "filename"]), part.title, part.tool_name]);
}

/** 编辑 Tool 的旧文 / 新文对照。 */
function edit_pairs(part: SessionAgentToolPart): AgentActivityEditPair[] {
  const input = object_value(part.input);
  const edits_value = input?.["edits"];
  const edits = Array.isArray(edits_value)
    ? edits_value.flatMap((entry) => object_value(entry) ?? [])
    : [];
  if (edits.length > 0) {
    return edits.map((edit) => ({ old_text: pick_text(edit, ["old_text"]), new_text: pick_text(edit, ["new_text"]) }));
  }
  const direct: AgentActivityEditPair = { old_text: pick_text(input, ["old_text"]), new_text: pick_text(input, ["new_text"]) };
  if (direct.old_text || direct.new_text) return [direct];
  // 输入尚未收口时只有 JSON 原文，按同一组字段读取已经到达的部分文本。
  if (part.state !== "input-streaming") return [];
  const old_values = read_streaming_input_values(part.input_text, "old_text");
  const new_values = read_streaming_input_values(part.input_text, "new_text");
  return Array.from({ length: Math.max(old_values.length, new_values.length) }, (_, index) => ({
    old_text: old_values[index] ?? "",
    new_text: new_values[index] ?? "",
  }));
}

/** 构造等宽代码详情。 */
function code_detail(text: string): AgentActivityDetail | null {
  return text ? { type: "code", text } : null;
}

/** 构造 shell 的命令与控制台详情。 */
function console_detail(part: SessionAgentToolPart): AgentActivityDetail | null {
  const command = read_input(part, ["cmd", "command", "input"]);
  const output = read_output(part, ["output", "text", "content", "message"]);
  const text = [command ? `$ ${command}` : "", output].filter(Boolean).join("\n");
  return text ? { type: "console", text } : null;
}

/** 取第一个非空文本；`undefined` 与空白都视为缺失。 */
function first_text(values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return "";
}

/** 用 " · " 连接非空文本。 */
function join_text(values: readonly string[]): string {
  return values.filter((value) => value.trim()).join(" · ");
}

/** 读取结构化值中给定字段的第一个非空文本。 */
function pick_text(value: unknown, fields: FieldNames): string {
  if (typeof value === "string") return value.trim();
  const record = object_value(value);
  if (!record) return "";
  for (const field of fields) {
    const item = record[field];
    if (typeof item === "string" && item.trim()) return item.trim();
    if (typeof item === "number" || typeof item === "boolean") return String(item);
  }
  return "";
}

/** 把没有稳定字段的结构化结果压成可读文本；未知结构不隐藏。 */
function compact_text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(compact_text).filter(Boolean).join("\n");
  const record = object_value(value);
  if (!record) return "";
  return Object.entries(record).flatMap(([field, item]) => {
    const text = compact_text(item);
    return text ? [`${field}: ${text}`] : [];
  }).join("\n");
}

/** 读取普通对象；数组与 null 都视为没有结构化内容。 */
function object_value(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * 根据携带的输入识别 Tool 的稳定视觉种类。
 *
 * 关键点（中文）
 * - 内置 Tool 按名字识别。
 * - power 不按名字识别：power 名即工具名，第三方的名字无法枚举。
 *   改按契约识别：输入带字符串 `action` 字段的工具就是 power 工具。
 */
function resolve_agent_tool_visual_kind(part: SessionAgentToolPart): AgentToolVisualKind {
  const normalized = part.tool_name.toLowerCase();
  if (normalized === "read" || normalized.endsWith("_read")) return "read";
  if (normalized === "write" || normalized.endsWith("_write")) return "write";
  if (normalized === "edit" || normalized.endsWith("_edit")) return "edit";
  if (normalized === "grep" || normalized.includes("search")) return "grep";
  if (normalized === "find" || normalized.includes("glob")) return "find";
  if (normalized === "shell_exec" || normalized === "shell_session" || normalized.includes("terminal")) return "shell";
  if (normalized === "ask_question" || normalized.includes("question")) return "ask";
  if (read_input(part, ["action"])) return "power";
  return "generic";
}

/** 将 Tool 生命周期收敛为对应视觉种类的翻译 key。 */
function resolve_tool_state_key(visual_kind: AgentToolVisualKind, state: SessionAgentToolPart["state"]): string {
  if (state === "waiting-user") return "activity.waiting_confirmation";
  return `activity.${visual_kind}.${state === "failed" ? "failed" : state === "completed" ? "completed" : "running"}`;
}

/** 将 Tool 生命周期收敛为活动行语气；被交互阻塞不是推进，因此与终态同为静态。 */
function resolve_tool_tone(state: SessionAgentToolPart["state"]): AgentActivityTone {
  if (state === "failed") return "failed";
  if (state === "completed" || state === "waiting-user") return "complete";
  return "running";
}
