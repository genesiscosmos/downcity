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
 * - 折叠行只计算身份、摘要和详情存在性；完整结果格式化由 read_detail 在展开时触发。
 * - 编辑对照按不可变 Part 弱引用缓存，供行数统计与展开正文共享，不延长消息生命周期。
 * - 本模块不依赖 React；组件负责 DOM、图标与交互。
 */

import { resolve_builtin_activity } from "./builtin_activity_detail.ts";
import { resolve_session_action, summarize_reasoning } from "./session_action_detail.ts";
import { bounded_text, read_input, read_streaming_input_values } from "./activity_detail_shared.ts";
export { read_streaming_input_values } from "./activity_detail_shared.ts";
import type { SessionAgentActionPart, SessionAgentReasoningPart, SessionAgentToolPart } from "@downcity/type";
import type {
  AgentActivityDetail,
  AgentActivityDiffStat,
  AgentActivityEditPair,
  AgentActivityPart,
  AgentActivityPresentation,
  AgentActivityTone,
  AgentToolIdentity,
  AgentToolVisualKind,
  ChatPowerLookup,
} from "../../types/activity";

/** 推理摘要只认独立标题行并限制长度；正文在展开时按文本和行数上限构造。 */
export function resolve_agent_reasoning_presentation(part: SessionAgentReasoningPart): AgentActivityPresentation {
  const running = part.state === "streaming";
  const summary = summarize_reasoning(part.text);
  return {
    visual_kind: "reasoning",
    state_key: running ? "activity.thinking" : "activity.thought",
    tone: running ? "running" : "complete",
    diff_stat: null,
    summary,
    read_detail: part.text.trim() ? () => {
      const text = bounded_text(part.text);
      return { type: "reasoning", text, preview_limited: text.length < part.text.length };
    } : undefined,
    error: "",
    input_streaming: running,
  };
}

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
  ["ask_user", "ask"],

]);

/**
 * 会修改项目文件的内置工具。
 *
 * 关键点（中文）：只有这两个会写盘；read / grep / find / ask_user 都不改项目内容。
 * 它决定活动行右侧是否出现改动行数标签，不改变任何判定或图标。
 */
const MUTATING_BUILTIN_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** 统计文本的行数；空文本算 0 行，不是 1 行。 */
function count_text_lines(text: string): number {
  return text ? text.split("\n").length : 0;
}


/** City 自有 Power 的稳定身份；不依赖可安装 Power 目录加载完成。 */
const CITY_OWNED_POWER_NAMES: ReadonlySet<string> = new Set(["context", "ai", "agent", "shell", "session"]);

/** City 直接注册的 power 在活动行上的标题。 */
const CITY_OWNED_POWER_TITLES: Readonly<Record<string, string>> = {
  context: "Context",
  ai: "AI",
  agent: "Agent",
  shell: "Shell",
  session: "Session",
};

/** 一个视觉种类需要的全部展示规则。 */
interface AgentToolRule {
  /** 活动行弱化摘要：目标对象或过程预览。 */
  summary(part: SessionAgentToolPart): string;
  /** 只判断内容是否存在，不为折叠行构造完整详情。 */
  has_detail(part: SessionAgentToolPart): boolean;
  /** 展开时才调用的详情构造器；异常或空结果由正文组件处理。 */
  detail(part: SessionAgentToolPart): AgentActivityDetail | null;
}

/** 没有专用展示协议的 Tool：注册名即摘要，输出正文即可展开内容。 */
const plain_tool_rule: AgentToolRule = {
  summary: (part) => part.tool_name,
  has_detail: (part) => has_compact_text(part.output) || Boolean(read_input(part, ["text", "query", "prompt", "path"])),
  detail: (part) => code_detail(read_output(part, ["result", "output", "text", "content", "message"]) || read_input(part, ["text", "query", "prompt", "path"])),
};

/** 可读内置工具只在专用适配器读取正文，折叠行不重复扫描输出。 */
const readable_tool_rule: AgentToolRule = {
  summary: () => "",
  has_detail: () => false,
  detail: () => null,
};

/**
 * 每个视觉种类的展示规则；新增种类时由类型系统强制补全。
 *
 * 内置工具的状态词本身就是动词（「已读取」「已搜索」），因此摘要只放目标对象；
 * power 的「谁在做」由身份文案表达，摘要放 action 参数。
 */
const AGENT_TOOL_RULES: Record<AgentToolVisualKind, AgentToolRule> = {
  // 这些工具的目标和正文由 resolve_builtin_activity 按明确结果契约提供。
  read: readable_tool_rule,
  write: readable_tool_rule,
  edit: readable_tool_rule,
  grep: readable_tool_rule,
  find: readable_tool_rule,
  ask: readable_tool_rule,
  power: readable_tool_rule,
  generic: plain_tool_rule,
};

/**
 * 判定一次 Tool 调用的稳定身份。
 *
 * 判定顺序即优先级，三点必须保持：
 * 1. **目录命中优先。** `power_names` 是「当前有哪些 power」的事实源，命中即 power，
 *    首帧就能确定身份，不会先显示成 unknown 再跳。
 * 2. **契约命中兜底。** 工具在目录未加载、
 *    或 power 已卸载后回看历史消息时，按 `{ action, args }` 输入契约判定。
 * 3. **白名单只覆盖闭集。** 两者都不命中就是 unknown，显示原始工具名，不猜语义。
 */
export function resolve_agent_tool_identity(
  part: SessionAgentToolPart,
  power_names?: ReadonlySet<string>,
): AgentToolIdentity {
  const action = read_input(part, ["action"]);
  if (power_names?.has(part.tool_name) || CITY_OWNED_POWER_NAMES.has(part.tool_name)) {
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

/** 按身份选取摘要、展开判断与详情共用的规则。 */
function tool_rule_of(identity: AgentToolIdentity): AgentToolRule {
  if (identity.kind === "power") return AGENT_TOOL_RULES.power;
  return identity.kind === "builtin" ? AGENT_TOOL_RULES[identity.tool] : AGENT_TOOL_RULES.generic;
}

/** 将 canonical Tool 映射为图标种类、身份、生命周期文案、语气、摘要与展开详情。 */
export function resolve_agent_tool_presentation(
  part: SessionAgentToolPart,
  power_names?: ReadonlySet<string>,
): AgentActivityPresentation {
  const identity = resolve_agent_tool_identity(part, power_names);
  const visual_kind = visual_kind_of(identity);
  const rule = tool_rule_of(identity);
  const base: AgentActivityPresentation = {
    visual_kind,
    tool_identity: identity,
    state_key: resolve_tool_state_key(visual_kind, part.state),
    state: part.state,
    tone: resolve_tool_tone(part.state),
    diff_stat: resolve_diff_stat(part, identity),
    summary: rule.summary(part),
    read_detail: rule.has_detail(part) ? () => rule.detail(part) : undefined,
    error: part.error?.trim() ?? "",
    input_streaming: part.state === "input-streaming",
  };
  return resolve_builtin_activity(part, identity, base);
}

/**
 * 从 Tool 自己的结构化输出算出改动行数。
 *
 * 关键点（中文）：**只读 Tool 的输出，不猜**。
 * - write：`lines_written` 就是新增行数；它不删行，因此 deletions 恒为 0。
 * - edit：逐项把 `old_text` / `new_text` 按行拆开相加，与 diff 的 `+N -M` 同语义。
 *
 * 三个前提：内置的 write / edit、成功终态、输出已经到达。
 * 失败没有产生任何改动；输入未收口时还不知道会写多少；power 不猜。
 */
function resolve_diff_stat(part: SessionAgentToolPart, identity: AgentToolIdentity): AgentActivityDiffStat | null {
  if (identity.kind !== "builtin") return null;
  if (!MUTATING_BUILTIN_TOOLS.has(part.tool_name)) return null;
  if (part.state !== "completed") return null;
  const output = object_value(part.output);
  if (!output) return null;
  if (part.tool_name === "write") {
    const additions = number_value(output["lines_written"]);
    return additions === null ? null : { additions, deletions: 0 };
  }
  const edits = Array.isArray(output["details"]) ? output["details"] : [];
  let additions = 0;
  let deletions = 0;
  // 同一 Part 的全部编辑对只解析一次，统计与按需展开共用不可变结果。
  const pairs = edit_pairs(part);
  for (const entry of edits) {
    const detail = object_value(entry);
    // 只有真正应用的项才算改动。
    if (detail?.["status"] !== "applied") continue;
    const index = number_value(detail["index"]);
    const pair = pairs[index ?? -1];
    if (!pair) continue;
    additions += count_text_lines(pair.new_text);
    deletions += count_text_lines(pair.old_text);
  }
  // 一项都没应用时不给标签，而不是显示 +0 -0。
  return additions === 0 && deletions === 0 ? null : { additions, deletions };
}

/**
 * 将 canonical Session Action 映射为图标种类、生命周期文案、语气、摘要与展开详情。
 *
 * Action 与 Tool 的差别集中在两点：种类按 `action_type` 识别，没有输入流式的中间态。
 * `description` 按语义分流：失败的 Action 把它当作错误原因，其余情况当作展开详情。
 */
export function resolve_agent_action_presentation(part: SessionAgentActionPart): AgentActivityPresentation {
  return resolve_session_action(part);
}

/** 读取 Tool 输出正文；没有稳定字段时回退为紧凑结构化文本。 */
function read_output(part: SessionAgentToolPart, fields: FieldNames): string {
  return pick_text(part.output, fields) || compact_text(part.output);
}

/** 编辑对照仅随不可变 Part 存活；分段卸载不会丢缓存，消息淘汰后可随键自动回收。 */
const edit_pairs_cache = new WeakMap<SessionAgentToolPart, AgentActivityEditPair[]>();

/** 一份编辑 Part 只解析一次，避免统计每个 applied 项时反复遍历全部输入。 */
function edit_pairs(part: SessionAgentToolPart): AgentActivityEditPair[] {
  const cached = edit_pairs_cache.get(part);
  if (cached) return cached;
  const pairs = build_edit_pairs(part);
  edit_pairs_cache.set(part, pairs);
  return pairs;
}

/** 编辑 Tool 的旧文 / 新文对照；调用方通过不可变 Part 缓存复用。 */
function build_edit_pairs(part: SessionAgentToolPart): AgentActivityEditPair[] {
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

/** 读取有限数值；缺失或不是数值时返回 null。 */
function number_value(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 只检查结构化结果是否有可读内容，发现首个有效值即返回，不创建详情字符串。 */
function has_compact_text(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(has_compact_text);
  const record = object_value(value);
  if (!record) return false;
  for (const field in record) {
    if (Object.hasOwn(record, field) && has_compact_text(record[field])) return true;
  }
  return false;
}

/** 把没有稳定字段的结构化结果压成可读文本；仅在展开详情时执行。 */
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
 * 与 City 直接注册的 `context` / `ai` / `agent` / `shell`。目录未加载时返回空表，判定会自动降级到输入契约，
 * 不会显示成未知工具。
 */
export function resolve_chat_power_lookup(powers: readonly { power_id: string; title: string; icon_url?: string }[]): ChatPowerLookup {
  const lookup = new Map<string, { title: string; icon_url?: string }>();
  for (const power_id of CITY_OWNED_POWER_NAMES) {
    lookup.set(power_id, { title: CITY_OWNED_POWER_TITLES[power_id] || power_id });
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

/** 将 Tool 生命周期收敛为对应视觉种类的翻译 key。 */
function resolve_tool_state_key(visual_kind: AgentToolVisualKind, state: SessionAgentToolPart["state"]): string {
  if (state === "waiting-user") return "activity.waiting_confirmation";
  return `activity.${visual_kind}.${state === "failed" ? "failed" : state === "completed" ? "completed" : "running"}`;
}

/** 将 Tool 生命周期收敛为活动行语气；被交互阻塞不是推进，因此与终态同为静态。 */
function resolve_tool_tone(state: SessionAgentToolPart["state"]): AgentActivityTone {
  if (state === "failed") return "failed";
  if (state === "waiting-user") return "waiting";
  if (state === "completed") return "complete";
  return "running";
}
