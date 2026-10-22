/**
 * task.toml 的文本编解码：`TOML 文本 ⇄ 普通结构`。
 *
 * ## 职责边界
 *
 * 这里只负责「文本 → `{ scalars, multiline, tables, arrays }`」与反向组装，
 * 不做任何字段校验，也不认识 `TaskDefinitionV1`。结构到领域对象的映射在
 * `Model.ts`，这样「文件不是合法 TOML」和「某个字段的值不合法」永远是两类错误。
 *
 * ## 为什么按段写入
 *
 * TOML 要求根级标量必须排在所有表之前，所以生成顺序固定为
 * 标量 → 多行文本 → 单表 → 数组表；`Object.entries` 的顺序不受控制，
 * 直接把整个对象交给序列化器会产出语法错误的文件。
 *
 * ## 正文用三引号
 *
 * `prompt` 与 `source` 都是多行文本，用 TOML 的**字面量字符串**（`'''`）：
 * 反斜杠、双引号、Markdown 原文都不需要转义，只有换行本身有意义。
 * 唯一的限制是正文自带 `'''`（例如 Python docstring 代码块）会让定界符提前结束，
 * 因此写入器在这种情况下降级到 `"""` 并转义——见 `serialize_string_field`。
 *
 * ## 尾随换行
 *
 * TOML 的多行字符串**总是**以一个换行结尾（来自闭合定界符前那个换行）。
 * 读取侧统一去掉尾随空行，因此业务层拿到的正文与用户写入的等价，
 * 不会出现「保存一次多一个换行」。
 */

import { parse as parse_toml, stringify as stringify_toml } from "smol-toml";

/**
 * 一行的键值对容器；序列化时按插入顺序输出。
 *
 * 用显式的「标量段 + 多行段」两段结构，而不是直接 dump 整个对象：
 * TOML 要求**根级数组必须排在任何表之前**，顺序写错就是语法错误，
 * 而 `Object.entries` 的顺序不受控制。
 */
export interface TaskDocumentScalars {
  /** 单行标量字段，按给定顺序输出。 */
  [key: string]: string | number | boolean | undefined;
}

/** 解析结果。 */
export interface TaskDocument {
  /** 单行标量。 */
  scalars: Record<string, unknown>;
  /** 多行字符串字段名 → 原文（已去掉尾随空行）。 */
  multiline: Record<string, string>;
  /** 数组表：表名 → 行对象数组。 */
  arrays: Record<string, Array<Record<string, unknown>>>;
  /** 单表：表名 → 对象。 */
  tables: Record<string, Record<string, unknown>>;
}

/** 判断一个值是否为「行对象数组」（TOML 的 `[[table]]`）。 */
function is_row_array(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item),
    )
  );
}

/** 判断一个值是否为普通对象（TOML 的 `[table]`）。 */
function is_table(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 解析 task.toml 文本。
 *
 * 只做结构分类，不做语义校验：合法性由 `Model.ts` 负责，这样这里的失败只可能是
 * 「文件不是合法 TOML」，而不会是「某个字段的值不合预期」。
 */
export function parse_task_document(
  text: string,
): { ok: true; document: TaskDocument } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = parse_toml(text);
  } catch (error) {
    return { ok: false, error: `Invalid TOML: ${String(error)}` };
  }
  if (!is_table(raw)) {
    return { ok: false, error: "Invalid task.toml: expected a table at the root" };
  }
  const document: TaskDocument = {
    scalars: {},
    multiline: {},
    arrays: {},
    tables: {},
  };
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      // 多行字段在文件里带尾随换行，去掉后业务层不再需要关心它。
      document.multiline[key] = value.replace(/\n+$/, "");
      document.scalars[key] = document.multiline[key];
      continue;
    }
    if (is_row_array(value)) {
      document.arrays[key] = value;
      continue;
    }
    if (is_table(value)) {
      document.tables[key] = value;
      continue;
    }
    document.scalars[key] = value;
  }
  return { ok: true, document };
}

/**
 * 写入一个可能含三引号的字符串字段。
 *
 * 首选 `'''`：正文里的反斜杠、引号全部保持原样，用户看到的文件与他在界面里写的
 * 逐字一致。仅当正文自身含 `'''` 时才降级到 `"""`——那时必须转义反斜杠与三连双引号，
 * 因为 `"""` 会解释转义序列。
 */
function serialize_string_field(key: string, value: string): string {
  const body = value.replace(/\n+$/, "");
  if (!body.includes("'''")) return `${key} = '''\n${body}\n'''`;
  const escaped = body.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  return `${key} = """\n${escaped}\n"""`;
}

/**
 * 生成 task.toml 文本。
 *
 * 结构固定为：标量段 → 多行段 → 单表段 → 数组表段。TOML 要求数组表排在标量之后，
 * 而 `[[occurrences]]` 与 `[[inbox]]` 都在最后，因此这个顺序始终合法。
 */
export function build_task_document(input: {
  /** 单行标量；`undefined` 表示省略该键。 */
  scalars: TaskDocumentScalars;
  /** 多行文本字段，按给定顺序输出。 */
  multiline?: Array<{ /** 文件中的键名。 */ key: string; /** 字段原文。 */ value: string }>;
  /** 单表；空对象会被省略。 */
  tables?: Array<{ /** 表名。 */ key: string; /** 表内容。 */ value: Record<string, unknown> }>;
  /** 数组表；空数组会被省略。 */
  arrays?: Array<{
    /** 表名。 */
    key: string;
    /** 行对象数组。 */
    value: Array<Record<string, unknown>>;
  }>;
}): string {
  const blocks: string[] = [];
  const scalar_lines: string[] = [];
  for (const [key, value] of Object.entries(input.scalars)) {
    if (value === undefined) continue;
    // 标量一律走 TOML 的 dump：字符串会被正确加引号，数字与布尔保持类型。
    scalar_lines.push(stringify_toml({ [key]: value }).trim());
  }
  if (scalar_lines.length) blocks.push(scalar_lines.join("\n"));

  for (const field of input.multiline ?? []) {
    if (!field.value) continue;
    blocks.push(serialize_string_field(field.key, field.value));
  }

  for (const table of input.tables ?? []) {
    if (Object.keys(table.value).length === 0) continue;
    blocks.push(stringify_toml({ [table.key]: table.value }).trim());
  }

  for (const array of input.arrays ?? []) {
    if (array.value.length === 0) continue;
    blocks.push(stringify_toml({ [array.key]: array.value }).trim());
  }

  return `${blocks.join("\n\n")}\n`;
}
