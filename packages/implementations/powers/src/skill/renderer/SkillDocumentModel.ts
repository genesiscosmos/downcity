/**
 * SKILL.md 阅读模型：分离 front matter 与正文，将 YAML 转为只含文本的元数据树。
 * 解析失败时保留头部原文；限制嵌套深度并识别循环别名，避免异常 YAML 阻断阅读。
 */
import yaml from "js-yaml";
import { parse_front_matter } from "../runtime/Frontmatter.js";

/** 可直接交给阅读组件的单个元数据字段。 */
export interface SkillMetadataField {
  /** YAML 中的原始字段名，数组元素使用从 1 开始的序号。 */
  readonly label: string;
  /** 标量、空集合或不能继续展开的引用的纯文本表示。 */
  readonly value?: string;
  /** 对象或数组的下一级字段；与 value 互斥。 */
  readonly children?: readonly SkillMetadataField[];
}

/** 技能文档的展示数据；名称和描述由调用方提供缺省值。 */
export interface SkillDocument {
  /** front matter 中非空的名称。 */
  readonly name?: string;
  /** front matter 中的描述，保留作者提供的换行。 */
  readonly description?: string;
  /** 已移除 front matter 的 Markdown 正文。 */
  readonly body: string;
  /** 默认可见的作者、版本和许可证字段。 */
  readonly summary: readonly SkillMetadataField[];
  /** 默认收起的其余元数据，保留 YAML 层级。 */
  readonly metadata: readonly SkillMetadataField[];
  /** 头部解析失败时供用户检查的 YAML 原文。 */
  readonly invalid_yaml?: string;
}

/** 将 YAML 标量与集合转换成可安全呈现的文本树，不执行或渲染其中的标记。 */
function metadata_field(label: string, value: unknown, ancestors: readonly object[] = []): SkillMetadataField {
  if (value === null || value === undefined) return { label, value: "null" };
  if (typeof value !== "object") return { label, value: String(value) };
  if (ancestors.includes(value)) return { label, value: "[循环引用]" };
  if (ancestors.length >= 12) return { label, value: "[嵌套层级过深]" };
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index + 1), entry] as const)
    : Object.entries(value);
  if (!entries.length) return { label, value: Array.isArray(value) ? "[]" : "{}" };
  return { label, children: entries.map(([key, entry]) => metadata_field(key, entry, [...ancestors, value])) };
}

/** 解析阅读内容；非映射或无效 YAML 留在元数据区，正文仍可阅读。 */
export function parse_skill_document(content: string): SkillDocument {
  const { front_matter_yaml, body } = parse_front_matter(content);
  const empty = { body, summary: [], metadata: [] };
  if (front_matter_yaml === null || !front_matter_yaml.trim()) return empty;
  try {
    const loaded: unknown = yaml.load(front_matter_yaml, { schema: yaml.JSON_SCHEMA });
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      return { ...empty, invalid_yaml: front_matter_yaml };
    }
    const fields = loaded as Record<string, unknown>;
    const name = typeof fields.name === "string" ? fields.name.trim() || undefined : undefined;
    const description = typeof fields.description === "string" ? fields.description.trim() : undefined;
    const summary_keys = new Set(["author", "version", "license"]);
    const summary: SkillMetadataField[] = [];
    const metadata: SkillMetadataField[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if ((key === "name" && name !== undefined) || (key === "description" && description !== undefined)) continue;
      (summary_keys.has(key) ? summary : metadata).push(metadata_field(key, value, [loaded]));
    }
    return { body, name, description, summary, metadata };
  } catch {
    return { ...empty, invalid_yaml: front_matter_yaml };
  }
}
