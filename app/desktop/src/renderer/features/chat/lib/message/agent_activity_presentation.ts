/**
 * Agent 活动（Reasoning / Tool / Action）canonical 状态到展示语义的唯一映射。
 *
 * 关键点（中文）
 * - Tool 的种类判断、生命周期文案、单行摘要与展开详情都在这里定义一次；组件只渲染结果，
 *   不按 Tool 名称分支。Action 共用同一套结果结构，按 action_type 识别种类。
 * - **身份与摘要是两件事。** 身份回答「谁在做」（内置工具 / 哪个 power 的哪个 action），
 *   摘要回答「对什么做」（文件路径、命令、查询词）。此前两者被压成一个字符串，
 *   于是 power 名与 action id 以原始英文标识符的形式裸露在界面上。
 * - **不猜语义。** 内置工具是闭集，按白名单判定；power 按目录与唯一输入契约判定；
 *   两者都不命中就是 unknown，显示原始工具名。子串启发式（`includes("search")`）已删除：
 *   它会误伤 `research`、`web_search`、`questionnaire`，而这些名字的归属上游本来就知道。
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
  AgentToolIdentity,
  AgentToolVisualKind,
  ChatPowerLookup,
} from "@/features/chat/types/AgentMessage";

/** 输入字段的候选名，按优先级排列。 */
type FieldNames = readonly string[];

/**
 * 内置 Tool 的白名单：工具名 → 视觉种类。
 *
 * 关键点（中文）：这是 Workspace 与 Agent 注册的全部非 power 工具（见 WorkspaceTools 与
 * DesktopAgentAssembly）。它是闭集，因此白名单是安全的判定方式，不会误伤第三方名字。
 */
const BUILTIN_TOOL_KINDS: ReadonlyMap<string, Exclude<AgentToolVisualKind, "power" | "generic">> = new Map([
  ["read", "read"],
  ["write", "write"],
  ["edit", "edit"],
  ["grep", "grep"],
  ["find", "find"],
  ["ask_question", "ask"],
]);

/**
 * 会修改项目文件的内置工具。
 *
 * 关键点（中文）：只有这两个会写盘；read / grep / find / ask_question 都不改项目内容。
 * 它只影响活动行的强调色，不改变任何判定或图标。
 */
const MUTATING_BUILTIN_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);


/**
 * 由 City 直接注册、不经过 Desktop Power catalog 的 power。
 *
 * 关键点（中文）：`city` 与 `shell` 在 City 启动时直接加入 PowerRuntime，Desktop 的
 * Power catalog 只包含随 package 发布的 5 个功能型 power（skill / task / chat / memory / web）。
 * 它们既没有 sidebar 也没有 mainview，不能塞进 catalog（会污染 Power 列表），
 * 但它们在活动行上必须与其它 power 一样有标题和语义图标，因此在这里显式登记。
 * 缺口是封闭的 2 项，静态登记是合理成本。
 */
const CITY_OWNED_POWER_NAMES: ReadonlySet<string> = new Set(["city", "shell"]);

/** 一个视觉种类需要的全部展示规则。 */
interface AgentToolRule {
  /** `input-streaming` 时是否自动展开一次；只有会产生大段输入的写入类 Tool 需要。 */
  auto_open_while_streaming: boolean;
  /** 活动行弱化摘要：目标对象或过程预览。 */
  summary(part: SessionAgentToolPart): string;
  /** 展开详情；null 表示没有可展开内容。 */
  detail(part: SessionAgentToolPart): AgentActivityDetail | null;
}

/** 没有专用展示协议的 Tool：注册名即摘要，输出正文即可展开内容。 */
const plain_tool_rule: AgentToolRule = {
  auto_open_while_streaming: false,
  summary: (part) => part.tool_name,
  detail: (part) => code_detail(read_output(part, ["result", "output", "text", "content", "message"]) || read_input(part, ["text", "query", "prompt", "path"])),
};

/**
 * 每个视觉种类的展示规则；新增种类时由类型系统强制补全。
 *
 * 内置工具的状态词本身就是动词（「已读取」「已搜索」），因此摘要只放目标对象；
 * power 的「谁在做」由身份文案表达，摘要放 action 参数。
 */
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
    summary: (part) => first_text([read_input(part, ["pattern", "query", "text"]), part.tool_name]),
    detail: (part) => code_detail(read_output(part, ["matches", "files", "results", "output", "text"]) || read_input(part, ["query", "pattern", "glob", "path"])),
  },
  find: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([read_input(part, ["pattern", "glob", "path"]), part.tool_name]),
    detail: (part) => code_detail(read_output(part, ["files", "matches", "results", "output", "text"]) || read_input(part, ["glob", "pattern", "path"])),
  },
  ask: {
    auto_open_while_streaming: false,
    // 问题标题由下方的交互卡片完整展示，活动行再说一遍就是重复；
    // 以前这里回退到 `tool_name`，用户看到的是裸露的 `ask_question`。
    summary: () => "",
    detail: (part) => code_detail(read_output(part, ["result", "output", "text", "content", "message"]) || read_input(part, ["title"])),
  },
  /**
   * Power 的摘要：action 参数预览。
   *
   * 关键点（中文）：参数在 `args` 内，是唯一需要读一层嵌套输入的种类；
   * power 名与 action 名不在这里——它们由 `power` 身份文案表达，重复出现只会让一行变长。
   * 候选字段按 action 的实际入参取：shell 的 cmd、search 的 query、read 的 memory_id。
   */
  power: {
    auto_open_while_streaming: false,
    summary: (part) => first_text([
      read_input(part, ["cmd", "command", "input"]),
      pick_text(object_value(part.input)?.["args"], ["cmd", "command", "query", "text", "url", "path", "file_path", "memory_id", "shell_id", "title", "name"]),
    ]),
    detail: (part) => code_detail(read_output(part, ["result", "output", "text", "message"])
      || read_input(part, ["action"])
      || pick_text(object_value(part.input)?.["args"], ["text", "query", "name", "title", "path", "url"])),
  },
  generic: plain_tool_rule,
};

/**
 * 判定一次 Tool 调用的稳定身份。
 *
 * 判定顺序即优先级，三点必须保持：
 * 1. **目录命中优先。** `power_names` 是「当前有哪些 power」的事实源，命中即 power，
 *    首帧就能确定身份，不会先显示成 unknown 再跳。
 * 2. **契约命中兜底。** 目录未加载、或 power 已卸载后回看历史消息时，按 power 工具的唯一
 *    输入契约 `{ action, args }` 判定。它与内置白名单互斥：Agent 注册工具时会拒绝重名。
 * 3. **白名单只覆盖闭集。** 两者都不命中就是 unknown，显示原始工具名，不猜语义。
 */
export function resolve_agent_tool_identity(
  part: SessionAgentToolPart,
  power_names?: ReadonlySet<string>,
): AgentToolIdentity {
  const action = read_input(part, ["action"]);
  if (power_names?.has(part.tool_name)) {
    return { kind: "power", power_name: part.tool_name, action_name: action };
  }
  if (action) return { kind: "power", power_name: part.tool_name, action_name: action };
  const builtin = BUILTIN_TOOL_KINDS.get(part.tool_name);
  if (builtin) return { kind: "builtin", tool: builtin };
  return { kind: "unknown", tool_name: part.tool_name };
}

/** 把身份映射为行首图标种类。 */
function visual_kind_of(identity: AgentToolIdentity): AgentToolVisualKind {
  if (identity.kind === "builtin") return identity.tool;
  if (identity.kind === "power") return "power";
  return "generic";
}

/**
 * 由身份生成活动行摘要。
 *
 * 关键点（中文）：摘要只服务内置工具与未知工具——power 的「谁在做」已经由身份文案给出，
 * 这里只补参数预览，避免把同一个事实说两遍。
 */
function summarize_by_identity(part: SessionAgentToolPart, identity: AgentToolIdentity): string {
  if (identity.kind === "power") return AGENT_TOOL_RULES.power.summary(part);
  if (identity.kind === "builtin") return AGENT_TOOL_RULES[identity.tool].summary(part);
  return AGENT_TOOL_RULES.generic.summary(part);
}

/** 由身份生成展开详情。 */
function detail_by_identity(part: SessionAgentToolPart, identity: AgentToolIdentity): AgentActivityDetail | null {
  // Shell 已收敛为 power，但它的输出仍然是终端会话：命令用 `$ ` 提示、输出保持等宽。
  // 这不是按名字分支展示语义，而是同一个 power 的详情形态选择。
  if (identity.kind === "power") {
    return identity.power_name === "shell" ? console_detail(part) : AGENT_TOOL_RULES.power.detail(part);
  }
  if (identity.kind === "builtin") return AGENT_TOOL_RULES[identity.tool].detail(part);
  return AGENT_TOOL_RULES.generic.detail(part);
}

/** 将 canonical Tool 映射为图标种类、身份、生命周期文案、语气、摘要与展开详情。 */
export function resolve_agent_tool_presentation(
  part: SessionAgentToolPart,
  power_names?: ReadonlySet<string>,
): AgentActivityPresentation {
  const identity = resolve_agent_tool_identity(part, power_names);
  const visual_kind = visual_kind_of(identity);
  return {
    visual_kind,
    tool_identity: identity,
    state_key: resolve_tool_state_key(visual_kind, part.state),
    tone: resolve_tool_tone(part.state),
    // 只有内置的 write / edit 确定会写盘；power 的写盘与否无法从名称判定，因此不猜。
    // 失败时不算写盘：那次写入没有发生，而且行内已经有一条红色错误要读，
    // 再用写入色会与“失败”互相抵消。
    mutation: identity.kind === "builtin" && MUTATING_BUILTIN_TOOLS.has(part.tool_name) && part.state !== "failed",
    summary: summarize_by_identity(part, identity),
    detail: detail_by_identity(part, identity),
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
    // Session Action 不是文件写入，不参与写盘强调色。
    mutation: false,
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
export function should_auto_open_agent_tool(part: SessionAgentToolPart, power_names?: ReadonlySet<string>): boolean {
  if (part.state !== "input-streaming") return false;
  const identity = resolve_agent_tool_identity(part, power_names);
  if (identity.kind === "power") return false;
  if (identity.kind === "unknown") return AGENT_TOOL_RULES.generic.auto_open_while_streaming;
  return AGENT_TOOL_RULES[identity.tool].auto_open_while_streaming;
}

/** 流式文件内容或待响应交互出现时，活动组自动展开一次但不锁定。 */
export function should_auto_open_agent_activity(parts: readonly AgentActivityPart[], power_names?: ReadonlySet<string>): boolean {
  return parts.some((part) => part.type === "tool"
    && (should_auto_open_agent_tool(part, power_names) || (part.interactions ?? []).some((interaction) => interaction.status === "pending")));
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
  return first_text([read_input(part, ["file_path", "path", "filename"]), part.tool_name]);
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

/**
 * 构造 shell 的命令与控制台详情。
 *
 * Shell 收敛为 power 后，命令落在 power 工具契约的 `args.cmd` 里，而不是顶层 `cmd`；
 * 因此这里与 power 摘要共用同一条嵌套读取规则，否则详情会只剩下输出。
 */
function console_detail(part: SessionAgentToolPart): AgentActivityDetail | null {
  const args = object_value(part.input)?.["args"];
  const command = first_text([
    read_input(part, ["cmd", "command", "input"]),
    pick_text(args, ["cmd", "command", "input"]),
  ]);
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
 * 解析活动行要用的 Power 事实表。
 *
 * 关键点（中文）：两处来源合并成一张表——Desktop Power catalog（含第三方安装的 power）
 * 与 City 直接注册的 `city` / `shell`。目录未加载时返回空表，判定会自动降级到输入契约，
 * 不会显示成未知工具。
 */
export function resolve_chat_power_lookup(powers: readonly { power_id: string; title: string; icon_url?: string }[]): ChatPowerLookup {
  const lookup = new Map<string, { title: string; icon_url?: string }>();
  for (const power_id of CITY_OWNED_POWER_NAMES) {
    lookup.set(power_id, { title: power_id === "city" ? "City" : "Shell" });
  }
  for (const power of powers) {
    lookup.set(power.power_id, {
      title: power.title || power.power_id,
      ...(power.icon_url ? { icon_url: power.icon_url } : {}),
    });
  }
  return lookup;
}

/** 从事实表取出全部 power 名，供身份判定使用。 */
export function chat_power_names(lookup: ChatPowerLookup): ReadonlySet<string> {
  return new Set(lookup.keys());
}

/**
 * 把一次 Power 调用解析为行内两段文案。
 *
 * 关键点（中文）：**只有 Power 有身份槽**。内置工具的状态词本身就是动词（「已读取」），
 * 再补一层「读取文件」就是把同一件事说两遍；未知工具则原样显示注册名。
 * 因此这里只接受 Power 身份，不接收整个联合类型。
 *
 * - 标题取自 catalog 或 City 登记（`city` / `shell` 不在 catalog，走登记）。
 * - 动作取自 i18n 字典；未命中时**原样显示 action id**——那是契约里的名字，
 *   拆点号或改写会误导。
 * - 输入未收口时 action 为空，此时只有标题（如「Shell」），不显示分隔符。
 */
export function resolve_power_identity_text(
  power_name: string,
  action_name: string,
  lookup: ChatPowerLookup,
  translate: (key: string, options?: Record<string, string>) => string,
): { label: string; action: string } {
  const label = lookup.get(power_name)?.title || power_name;
  if (!action_name) return { label, action: "" };
  const key = `activity.action_label.${power_name}.${action_name}`;
  const translated = translate(key);
  // i18next 未命中时返回 key 本身；此时回退到 action id 原文，而不是把 key 渲染给用户。
  return { label, action: translated === key ? action_name : translated };
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
