/**
 * Skill 共用阅读视图：标题和完整描述、常用字段、可折叠元数据与 Markdown 正文。
 * 两个阅读入口使用相同展示规则；元数据内容区使用主题背景，原生定义列表负责字段层级与换行。
 */
import { Fragment, useMemo, type ReactNode } from "react";
import type { PowerRendererUi } from "@downcity/city/power/react";
import { parse_skill_document, type SkillMetadataField } from "./SkillDocumentModel.js";

/** Skill 文档阅读所需内容与宿主 UI。 */
interface SkillDocumentProps {
  /** 宿主注入的统一语义组件与 UI 服务。 */
  readonly ui: PowerRendererUi;
  /** 完整 SKILL.md 原文，包含可选 YAML 头部。 */
  readonly content: string;
  /** 缺少有效 name 时展示的资源名称。 */
  readonly fallback_name: string;
  /** 缺少有效 description 时展示的资源描述。 */
  readonly fallback_description?: string;
  /** 阅读入口的可选操作，例如关闭当前 Agent 内的阅读视图。 */
  readonly actions?: ReactNode;
}

/** 元数据定义列表的输入，递归保留集合层级。 */
interface MetadataFieldsProps {
  /** 当前层级的有序字段列表。 */
  readonly fields: readonly SkillMetadataField[];
  /** 是否使用常用字段的中文显示名称。 */
  readonly summary?: boolean;
}

/** 两列字段在窄窗口内保持收缩，长值和原始换行始终可见。 */
function Metadata_fields({ fields, summary = false }: MetadataFieldsProps) {
  const labels: Record<string, string> = { author: "作者", version: "版本", license: "许可证" };
  return <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 3fr)", gap: "0.5rem 1rem", margin: 0 }}>
    {fields.map((field) => <Fragment key={field.label}>
      <dt style={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: 500 }}>{summary ? labels[field.label] ?? field.label : field.label}</dt>
      <dd style={{ minWidth: 0, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {field.children ? <Metadata_fields fields={field.children} /> : field.value === "" ? '""' : field.value}
      </dd>
    </Fragment>)}
  </dl>;
}

/** 分离 YAML 与 Markdown，所有元数据值作为纯文本呈现。 */
export function Skill_document({ ui, content, fallback_name, fallback_description, actions }: SkillDocumentProps) {
  const { Stack, Toolbar, Section, Group, Row, Markdown, Callout, CodeBlock, EmptyState } = ui.components;
  const document = useMemo(() => parse_skill_document(content), [content]);
  const description = document.description ?? fallback_description;
  return <Stack>
    <Toolbar
      title={<span style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{document.name ?? fallback_name}</span>}
      description={description ? <span style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{description}</span> : undefined}
      actions={actions}
    />
    {document.summary.length ? <Section><Metadata_fields fields={document.summary} summary /></Section> : null}
    {document.metadata.length || document.invalid_yaml !== undefined ? <Group label="元数据" collapsible default_expanded={false}>
      <div style={{ background: "var(--surface-emphasis)" }}>
        {document.invalid_yaml !== undefined ? <Row label={<Stack><Callout tone="warning">元数据无法解析为 YAML 字段，请检查原文。</Callout><CodeBlock>{document.invalid_yaml}</CodeBlock></Stack>} /> : <Row label={<Metadata_fields fields={document.metadata} />} />}
      </div>
    </Group> : null}
    <Section surface={false}>{document.body.trim() ? <Markdown text={document.body} /> : <EmptyState title="Skill 正文为空" size="compact" />}</Section>
  </Stack>;
}
