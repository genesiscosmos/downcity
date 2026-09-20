/**
 * Markdown 文档 frontmatter 的解析（Desktop 文件预览专用）。
 *
 * ## 为什么单独解析
 *
 * 文件预览此前把整份文件直接交给 Markdown 渲染器，于是起始的 `---` 头块被渲染成
 * 一条分隔线加若干段落：文件身份（标题、日期、标签、任务状态）与正文混在一起，
 * 既读不出层级，也分不清哪些是元数据、哪些是内容。
 *
 * 这里把「文档头」与「文档正文」拆成两份数据，预览层因此可以给元数据单独一套样式
 * （键值表），而正文从 frontmatter 之后开始渲染。
 *
 * ## 支持的 YAML 子集
 *
 * 只覆盖本仓库真实文档里出现的形状，**不做完整 YAML 实现**：
 *
 * | 形状 | 例子 | 结果 |
 * | --- | --- | --- |
 * | 标量 | `title: 发布说明` | 一行键值 |
 * | 带引号标量 | `when: "time:2026-09-20T10:00:00+08:00"` | 去掉引号，保留内部冒号 |
 * | 嵌套映射 | `metadata:` 后跟缩进 `version: 2.0.0` | 展平为 `metadata.version` |
 * | 行内序列 | `tags: [a, b]` | 标签 chip |
 * | 块序列 | `tags:` 后跟 `- a` | 标签 chip |
 * | 块标量 | `description: \|` 后跟缩进正文 | 原样 YAML 文本（`raw`） |
 *
 * ## 边界：不认识的东西原样展示，不猜
 *
 * 无法结构化的字段（块标量、更深嵌套、`- key: value` 这类混合序列）不会被丢掉，
 * 也不会被猜错：它们以 `raw` 形式原样展示，并把 `partial` 置为真，
 * 预览层据此提示「部分字段按原文展示」。源码视图始终显示原始 YAML。
 *
 * 需要完整 YAML 语义（锚点、多文档、复杂流式映射）时应换成真正的 YAML 解析器；
 * 替换点只有 `parse_workspace_document` 一处，调用方不感知解析细节。
 *
 * ## 一个有意保留的边界：块内出现独立 `---` 行
 *
 * frontmatter 以第一个独立 `---` 行结束，因此块内不能再出现独立 `---` 行
 *（标准 frontmatter 语义即如此，YAML 多文档也不在支持范围内）。
 *
 * 本模块是纯函数、不依赖 React，因此可被单测直接加载。
 */

/** 一条元数据字段；标量、序列、原始文本三者必有其一。 */
export interface WorkspaceMetadataEntry {
  /** 字段名；嵌套映射展平为 `parent.child`，与文件中的出现顺序一致。 */
  key: string;
  /** 标量值的可读文本；值不是标量时为空。 */
  text?: string;
  /** 标量序列的成员；值不是序列时为空。 */
  items?: string[];
  /** 无法结构化的原始 YAML 文本；值可结构化时为空。 */
  raw?: string;
}

/** 一份 Markdown 文档拆出的元数据与正文。 */
export interface WorkspaceDocumentParts {
  /** 元数据字段，按文件出现顺序；文件没有 frontmatter 时为空数组。 */
  entries: WorkspaceMetadataEntry[];
  /** frontmatter 之后的正文；文件没有 frontmatter 时就是原文。 */
  body: string;
  /** 是否存在只能按原文展示的字段。 */
  partial: boolean;
}

/** 顶层键：行首、无缩进，`key:` 之后可以没有值。 */
const top_level_key_pattern = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?$/;

/** 缩进键：嵌套映射的一层。 */
const nested_key_pattern = /^[ \t]+([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?$/;

/** 块序列项：`- value`。 */
const list_item_pattern = /^[ \t]*-[ \t]*(.*)$/;

/** 块标量标记：`|`、`|-`、`>`、`>+2` 等。 */
const block_scalar_pattern = /^[|>][+-]?\d*$/;

/**
 * 解析一份文档，拆出元数据与正文。
 *
 * 只有「文件以 `---` 行开头、且存在成对的结束 `---`、且块内至少解析出一条字段」时
 * 才认定为 frontmatter。这条约束是为了不吞掉以分隔线开头的普通文档：
 * 那种文件应当整份按正文渲染。
 *
 * 不返回 frontmatter 的原始 YAML：源码视图直接显示整份文件原文，
 * 单独再复制一份 YAML 文本只是重复，而重复的数据迟早与原文不一致。
 */
export function parse_workspace_document(content: string): WorkspaceDocumentParts {
  const text = String(content ?? "");
  const block = read_frontmatter_block(text);
  if (!block) return { entries: [], body: text, partial: false };

  const parsed = parse_metadata_lines(block.yaml.split(/\r?\n/));
  if (parsed.entries.length === 0) return { entries: [], body: text, partial: false };

  return { entries: parsed.entries, body: block.body, partial: parsed.partial };
}

/** 取出起始 `---` 与结束 `---` 之间的 YAML 文本，以及其后的正文。 */
function read_frontmatter_block(text: string): { yaml: string; body: string } | undefined {
  const opening = /^---[ \t]*\r?\n/.exec(text);
  if (!opening) return undefined;
  const rest = text.slice(opening[0].length);
  // 结束行必须是独立的一行 `---`；没有它就不是 frontmatter（例如未闭合的头部）。
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return undefined;
  return {
    yaml: rest.slice(0, closing.index).replace(/\r?\n$/, ""),
    body: rest.slice(closing.index + closing[0].length),
  };
}

/** 逐行解析 YAML 子集：顶层键 + 紧随其后的缩进块。 */
function parse_metadata_lines(lines: readonly string[]): { entries: WorkspaceMetadataEntry[]; partial: boolean } {
  const entries: WorkspaceMetadataEntry[] = [];
  let syntax_partial = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (is_ignorable(line)) continue;
    const match = top_level_key_pattern.exec(line);
    if (!match) {
      // 顶层出现非 `key: value` 的行（例如顶层序列）说明这不是一份映射式 frontmatter。
      syntax_partial = true;
      continue;
    }
    const key = match[1]!;
    const inline_value = match[2];
    // 块标量必须连同后续缩进行一起取走，否则那段文字会既不在正文、也不在元数据里。
    const needs_block = inline_value === undefined || inline_value.trim() === "" || block_scalar_pattern.test(inline_value.trim());
    if (!needs_block) {
      entries.push(classify_inline_value(key, inline_value!));
      continue;
    }
    const block: string[] = [];
    while (index + 1 < lines.length && !is_top_level(lines[index + 1]!)) {
      block.push(lines[index + 1]!);
      index += 1;
    }
    entries.push(...classify_indented_block(key, block, inline_value?.trim() ?? ""));
  }

  return { entries, partial: syntax_partial || entries.some((entry) => entry.raw !== undefined) };
}

/** 行内值：序列、原始文本或标量。 */
function classify_inline_value(key: string, raw_value: string): WorkspaceMetadataEntry {
  const value = raw_value.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    // 流式映射或嵌套序列不做结构化，避免把 `[{a: 1}]` 拆成一串看似标签的碎片。
    if (inner.includes("{") || inner.includes("[")) return { key, raw: value };
    return { key, items: split_flow_sequence(inner) };
  }
  if (value.startsWith("{")) return { key, raw: value };
  if (block_scalar_pattern.test(value)) return { key, raw: value };
  return { key, text: read_scalar(value) };
}

/**
 * 缩进块：块序列、嵌套映射，或原样保留的文本。
 *
 * `block_scalar_marker` 非空表示这是一段块标量（`key: |`），此时整块按原文展示。
 */
function classify_indented_block(key: string, block: readonly string[], block_scalar_marker: string): WorkspaceMetadataEntry[] {
  const lines = block.filter((line) => !is_ignorable(line));
  if (lines.length === 0) {
    if (block_scalar_marker) return [{ key, raw: block_scalar_marker }];
    return [{ key, text: "" }];
  }

  if (block_scalar_marker) return [{ key, raw: [block_scalar_marker, ...dedent(lines)].join("\n") }];

  if (lines.every((line) => list_item_pattern.test(line))) {
    const items = lines.map((line) => read_scalar(list_item_pattern.exec(line)![1] ?? ""));
    // `- key: value` 是「对象序列」，没有可用的表格形状，按原文展示。
    if (items.some((item) => top_level_key_pattern.test(item) || item.startsWith("{"))) return [{ key, raw: dedent(lines).join("\n") }];
    return [{ key, items: items.filter((item) => item !== "") }];
  }

  if (lines.every((line) => nested_key_pattern.test(line))) {
    return lines.map((line) => {
      const match = nested_key_pattern.exec(line)!;
      const nested_key = match[1]!;
      const value = match[2];
      // 更深一层嵌套没有可读的表格形状，整块按原文展示，保持与文件一致。
      if (value === undefined || value.trim() === "") return { key, raw: dedent(lines).join("\n") };
      return classify_inline_value(`${key}.${nested_key}`, value);
    });
  }

  return [{ key, raw: dedent(lines).join("\n") }];
}

/** 空行与注释行不参与解析。 */
function is_ignorable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/** 是否是一行顶层键；缩进行与空行都不算。 */
function is_top_level(line: string): boolean {
  return !is_ignorable(line) && line.length === line.trimStart().length;
}

/** 去掉所有行共有的缩进，让原样展示的文本不带着 frontmatter 的对齐空格。 */
function dedent(lines: readonly string[]): string[] {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(common));
}

/** 读出一个标量：去掉成对引号并还原转义；未加引号时按原样保留。 */
function read_scalar(raw_value: string): string {
  const value = raw_value.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, (_all, character: string) => {
      if (character === "n") return "\n";
      if (character === "t") return "\t";
      if (character === "r") return "\r";
      return character;
    });
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** 拆开 `[a, b, "c, d"]`：只按引号外的逗号切分。 */
function split_flow_sequence(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (const character of inner) {
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  items.push(current);
  return items.map(read_scalar).filter((item) => item !== "");
}
