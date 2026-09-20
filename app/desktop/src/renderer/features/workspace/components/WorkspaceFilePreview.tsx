/**
 * Workspace 文本文件预览的共享构件。
 *
 * Workspace 主视图与 Chat 右侧「文件」面板展示同一份文件内容，差别只在页面外壳：
 * 前者用 MainView Header 承担文件路径，后者在窄栏里自己排一行。
 * 因此这里只保留与外壳无关的部分——读取、加载/失败占位、源码逐行渲染与行号定位、
 * Markdown 渲染。文件操作菜单与元数据卡片各自独立成模块
 * （`WorkspaceFileActionsMenu` / `WorkspaceFileMetadata`），它们与外壳无关，但自成一体。
 *
 * ## 阅读模式：预览是默认，源码在菜单里
 *
 * 此前顶栏常驻一个「预览 / 源码」分段控件：绝大多数阅读发生在预览里，
 * 而它是 Markdown 专属却常驻顶栏，非 Markdown 文件没有它，顶栏形状在两类文件之间变化。
 * 现在顶栏右侧只有一个文件操作菜单，源码模式是其中一项开关，两类文件共用同一形状。
 * 初始模式由 `resolve_default_view_mode` 决定（带行号的链接先进源码）。
 *
 * ## 元数据为什么单独一套样式
 *
 * Markdown 文档起始的 `---` 头块此前被当成正文渲染：一条分隔线加若干段落，
 * 文件身份与内容混在一起。现在它由 `lib/workspace/workspace_frontmatter` 解析成键值数据，
 * 交给 `WorkspaceFileMetadataCard` 呈现，正文从 frontmatter 之后开始。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { TbLoader2 } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { cn } from "@/lib/utils";
import { parse_workspace_document } from "@/lib/workspace/workspace_frontmatter";
import { highlight_code_lines, type HighlightedToken } from "@/lib/workspace/workspace_code_highlighter";
import { resolve_workspace_language, type WorkspaceLanguage } from "@/lib/workspace/workspace_file_language";
import { resolve_default_view_mode, type WorkspaceFileViewMode } from "@/lib/workspace/workspace_file_preview";
import { use_translation } from "@/locales/i18n";
import { WorkspaceFileMetadataCard } from "./WorkspaceFileMetadata";
import type { DesktopWorkspaceTextFile } from "@common/types/DesktopApi";

export type { WorkspaceFileViewMode };

/** 读取 Workspace 文本文件的实时状态。 */
export interface WorkspaceTextFileState {
  /** 读取成功的文件内容；尚未返回或读取失败时为空。 */
  file?: DesktopWorkspaceTextFile;
  /** 读取失败信息；为空表示没有失败。 */
  error: string;
}

/**
 * 读取 Workspace 文本文件。
 *
 * `relative_path` 为空时不发起读取（侧栏尚未打开任何文件时是常态），
 * 这样调用方可以无条件使用本 Hook，不需要在外部做条件渲染。
 */
export function use_workspace_text_file(workspace_id: string, relative_path: string): WorkspaceTextFileState {
  const [file, set_file] = useState<DesktopWorkspaceTextFile>();
  const [error, set_error] = useState("");
  useEffect(() => {
    if (!relative_path) {
      set_file(undefined);
      set_error("");
      return;
    }
    let active = true;
    set_file(undefined);
    set_error("");
    void window.downcity.workspace.read_text_file(workspace_id, relative_path)
      .then((value) => { if (active) set_file(value); })
      .catch((reason: unknown) => { if (active) set_error(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [workspace_id, relative_path]);
  return { file, error };
}

/**
 * 当前阅读模式。
 *
 * 打开新文件时回到初始模式（带行号的链接先进源码），用户随后的手动切换不被覆盖：
 * 切换动作只改状态，重算只发生在 `relative_path` / `line` 变化时。
 */
export function use_workspace_file_view_mode(relative_path: string, line?: number): [WorkspaceFileViewMode, (mode: WorkspaceFileViewMode) => void] {
  const [mode, set_mode] = useState<WorkspaceFileViewMode>(() => resolve_default_view_mode(relative_path, line));
  useEffect(() => set_mode(resolve_default_view_mode(relative_path, line)), [relative_path, line]);
  return [mode, set_mode];
}

/** 文件读取中的加载态与读取失败占位，两处宿主共用。 */
export function WorkspaceFilePlaceholder({ error }: {
  /** 读取失败信息；为空表示仍在读取。 */
  error: string;
}) {
  const translate_resources = use_translation("resources");
  if (error) return <div className="mx-auto mt-20 max-w-lg rounded-item bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">{error}</div>;
  return <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="animate-spin" />{translate_resources("workspace.reading_file")}</div>;
}

/**
 * 源码视图：逐行渲染，便于定位并高亮单独一行。
 *
 * 整体放在一个 `<pre>` 里时无法定位某一行，因此每行都是独立块元素；
 * 末尾换行不代表最后一行存在，需要剔除，否则行号会整体偏一位。
 */
export function WorkspaceFileSourceBody({ file, relative_path, line, class_name }: {
  /** 已读取的文本文件。 */
  file: DesktopWorkspaceTextFile;
  /** Workspace 内相对路径；用于识别语言。 */
  relative_path: string;
  /** 需要滚动到视图中部并高亮的 1 基行号；未指定时从文件开头展示。 */
  line?: number;
  /** 宿主自己的内边距等排版样式。 */
  class_name?: string;
}) {
  const source_ref = useRef<HTMLDivElement>(null);
  const language = useMemo(() => resolve_workspace_language(relative_path), [relative_path]);
  // 末尾换行不代表最后一行存在，需要剔除，否则行号会整体偏一位。
  const { lines: source_lines, trimmed_trailing_newline } = useMemo(() => {
    const lines = file.content.split("\n");
    const trimmed = lines.length > 1 && lines[lines.length - 1] === "";
    return { lines: trimmed ? lines.slice(0, -1) : lines, trimmed_trailing_newline: trimmed };
  }, [file]);
  const tokens = use_highlighted_lines(file.content, language, source_lines.length, trimmed_trailing_newline);
  // 行内容就位后把目标行对齐到视图中部；滚动容器与该行的行高都由这一层决定。
  useEffect(() => {
    if (!line) return;
    source_ref.current?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView({ block: "center" });
  }, [file, line, tokens]);
  return <div ref={source_ref} className={cn("workspace-file-source min-h-full w-full font-mono text-xs leading-5 text-foreground selection:bg-primary/20", class_name)}>
    {source_lines.map((text, index) => <div key={index + 1} data-line={index + 1} className={cn("min-h-5 whitespace-pre-wrap break-words", index + 1 === line && "bg-surface-brand")}>
      {tokens?.[index]?.map((token, token_index) => <span key={token_index} style={token.style}>{token.content}</span>) ?? text}
    </div>)}
  </div>;
}

/**
 * 异步着色当前文件。
 *
 * 着色未就绪、语言未识别或失败时返回 undefined，此时按纯文本渲染：行结构完全一致，
 * 因而着色完成后不会发生跳动；换文件或卸载时丢弃旧结果，避免把上一个文件的颜色写到新文件上。
 */
function use_highlighted_lines(content: string, language: WorkspaceLanguage | undefined, line_count: number, trimmed_trailing_newline: boolean) {
  const [tokens, set_tokens] = useState<HighlightedToken[][]>();
  useEffect(() => {
    if (!language) {
      set_tokens(undefined);
      return;
    }
    let active = true;
    set_tokens(undefined);
    // 传入原样行数：着色器按 split("\n") 的完整结果返回，末尾空行在展示时再剔除。
    const raw_line_count = trimmed_trailing_newline ? line_count + 1 : line_count;
    void highlight_code_lines(content, language, raw_line_count).then((result) => {
      if (!active) return;
      set_tokens(result && trimmed_trailing_newline ? result.slice(0, -1) : result);
    });
    return () => { active = false; };
  }, [content, language, line_count, trimmed_trailing_newline]);
  return tokens;
}

/**
 * Markdown 渲染视图：元数据卡片在前，正文在后。
 *
 * 内边距由宿主通过 `class_name` 给出（主视图与窄面板不同），本组件只管文档内部节奏。
 * 卡片与正文之间不写间距：卡片自己带 `mb-3`，理由见 `WorkspaceFileMetadataCard`。
 */
export function WorkspaceFileMarkdownBody({ content, class_name }: {
  /** Markdown 原文。 */
  content: string;
  /** 宿主自己的排版样式。 */
  class_name?: string;
}) {
  const document = useMemo(() => parse_workspace_document(content), [content]);
  return <article className={cn("min-h-full w-full text-base leading-[1.7] text-foreground", class_name)}>
    {document.entries.length > 0 ? <WorkspaceFileMetadataCard entries={document.entries} partial={document.partial} /> : null}
    <Markdown text={document.body} mode="static" />
  </article>;
}
