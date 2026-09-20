/**
 * 文档 frontmatter 的元数据卡片。
 *
 * ## 为什么单独一套样式
 *
 * Markdown 文档起始的 `---` 头块此前被当成正文渲染：一条分隔线加若干段落，
 * 文件身份（标题、日期、标签、状态）与内容混在一起，读不出层级也分不清哪部分是元数据。
 * 现在它由 `lib/workspace/workspace_frontmatter` 解析成键值数据，用**卡片 + 键值表**呈现，
 * 正文从 frontmatter 之后开始。源码模式仍显示原始 YAML，两种形态不会互相丢失信息。
 *
 * ## 结构是 `<dl>`，不是一堆 `<div>`
 *
 * 字段名与值天然是「名—值」对，`<dl>` 让读屏成对朗读；用 `<div>` 拼表则两者互不关联，
 * 读屏用户会听到一串没有归属的字符串。三列网格（名称 / 值）也由 `<dl>` 直接承担，
 * 不需要额外的行容器。
 *
 * ## 三类值各自的呈现
 *
 * | 值的形状 | 呈现 | 理由 |
 * | --- | --- | --- |
 * | 标量 | 一行文本 | 绝大多数字段 |
 * | 序列 | chip 列表，自动换行 | 标签、关键词这类并列短词 |
 * | 无法结构化 | 原样等宽文本块 | 块标量、对象序列；宁可多一段原文，也不猜错 |
 *
 * ## 字段名列为什么是有上限的百分比，而不是 `auto`
 *
 * 两列网格里如果名称列用 `minmax(4.5rem, auto)`，一个超长的字段名会把列撑到
 * max-content，值列（`1fr`）随之被挤到 0 宽——值看不见了，而页面不会报任何错。
 * 给一个上限（`minmax(4.5rem, 32%)`）之后，列宽对容器确定，`truncate` 也能真正生效，
 * 两个字段名很长的文档与两个字段名很短的文档不会得到两种排版。
 *
 * ## 卡片不折叠，间距由卡片自己给
 *
 * 元数据通常只有几行，折叠等于让用户多按一次才能看到「这份文件是什么」，
 * 而这恰恰是打开文档时最先要确认的东西。
 *
 * 卡片与正文之间的间距用卡片自己的 `mb-3`（0.75rem = 12px）：卡片不属于 `.markdown`
 * 的内部节奏（那三档只管文档自己的段落之间），它是一块插在正文之前的独立表面；
 * 取值与应用里「块接块」的既有档位一致（见 `message_layout.ts` 的消息内块间距），
 * 且大于文档内部的正文档（0.5em ≈ 7.5px），两个层级因此分得开。
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { WorkspaceMetadataEntry } from "@/lib/workspace/workspace_frontmatter";

/** 元数据卡片属性。 */
interface WorkspaceFileMetadataCardProps {
  /** 已解析的元数据字段，按文件出现顺序。 */
  entries: readonly WorkspaceMetadataEntry[];
  /** 是否存在只能按原文展示的字段。 */
  partial: boolean;
}

/** frontmatter 元数据卡片。 */
export function WorkspaceFileMetadataCard({ entries, partial }: WorkspaceFileMetadataCardProps) {
  const translate_resources = use_translation("resources");
  const label_id = use_metadata_label_id();
  return <section aria-labelledby={label_id} className="mb-3 min-w-0 rounded-surface bg-surface-subtle px-3.5 py-3">
    <div id={label_id} className="mb-2 text-2xs text-muted-foreground">{translate_resources("workspace.metadata_label")}</div>
    <dl className="grid min-w-0 grid-cols-[minmax(4.5rem,32%)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
      {entries.map((entry, index) => <MetadataRow key={`${entry.key}:${index}`} entry={entry} />)}
    </dl>
    {partial ? <p className="mt-2.5 text-2xs leading-5 text-muted-foreground">{translate_resources("workspace.metadata_partial")}</p> : null}
  </section>;
}

/**
 * 一行元数据：字段名在左，值在右。
 *
 * 名称用等宽体并允许截断（`title` 保留全文）：字段名是文档作者写的标识符，
 * 等宽体让 `metadata.version` 这类点分名读起来是一个整体。
 */
function MetadataRow({ entry }: {
  /** 单个元数据字段。 */
  entry: WorkspaceMetadataEntry;
}) {
  return <>
    <dt className="min-w-0 truncate font-mono text-2xs text-muted-foreground" title={entry.key}>{entry.key}</dt>
    <dd className="m-0 min-w-0 text-xs leading-5 text-foreground">
      {entry.items && entry.items.length > 0
        ? <ul className="flex flex-wrap gap-1">{entry.items.map((item, index) => <li key={`${item}:${index}`} className="max-w-full truncate rounded-full bg-surface-emphasis px-2 text-2xs leading-5 text-muted-foreground" title={item}>{item}</li>)}</ul>
        : entry.raw !== undefined
          ? <pre className="m-0 min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-item bg-surface-emphasis px-2 py-1.5 font-mono text-2xs leading-5 text-muted-foreground">{entry.raw}</pre>
          // 空值显示为「—」而不是留白：留白会被读成「这一行没有值」与「渲染失败」两种意思。
          : <span className={cn("break-words", !entry.text && "text-muted-foreground")}>{entry.text || "—"}</span>}
    </dd>
  </>;
}

/** 元数据分区的无障碍名称标识。 */
let metadata_label_sequence = 0;

/** 每次挂载取一个新 id：同一页面可能同时渲染多个预览（主视图 + 多个标签页）。 */
function use_metadata_label_id(): string {
  const [id] = useState(() => `workspace-metadata-${++metadata_label_sequence}`);
  return id;
}
