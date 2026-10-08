/**
 * 文档页面版式模块。
 *
 * 负责单篇文档的呈现：标题、摘要、复制原始 Markdown、正文容器与上下页导航。
 * 版式固定为「一个 H1 + 一段摘要 + 正文」，因此正文里禁止再写一级标题——
 * 这既是可访问性要求，也被构建后的测试强制校验。
 *
 * 正文排版由 `.docs-markdown` 类承担（见 `app.css`），不再依赖文档框架的 typography
 * 插件：MDX 只输出语义标签，间距、层级与代码样式统一由站点自己的令牌控制。
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { CopyMarkdownButton } from "@/components/docs/copy-markdown-button";

/**
 * 文档正文版式。
 *
 * `current_url` 与 `title` 用于复制按钮：复制内容会带上页面地址，方便直接粘给 Agent。
 */
export function DocsArticle({
  title,
  description,
  raw_markdown,
  current_url,
  children,
}: {
  /** 页面标题，输出为正文唯一的 H1。 */
  title: string;
  /** 页面摘要，来自 frontmatter，为空时不渲染。 */
  description: string;
  /** 原始 MDX 文本，供复制按钮使用。 */
  raw_markdown: string;
  /** 当前页面公开 URL。 */
  current_url: string;
  /** 正文内容。 */
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-8 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-serif text-[clamp(1.75rem,3.4vw,2.25rem)] font-bold leading-[1.15] tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          <CopyMarkdownButton raw_markdown={raw_markdown} page_url={current_url} />
        </div>
        {description ? (
          <p className="text-base leading-[1.7] text-text-soft">{description}</p>
        ) : null}
      </header>
      <div className="docs-markdown">{children}</div>
    </article>
  );
}

/**
 * 文档上下页导航。
 *
 * 顺序与侧边栏一致，由文档索引提供，因此「读完这篇该看哪篇」始终与导航结构一致。
 */
export function DocsPager({
  previous,
  next,
}: {
  /** 同一空间内的上一篇页面。 */
  previous?: { title: string; url: string };
  /** 同一空间内的下一篇页面。 */
  next?: { title: string; url: string };
}) {
  if (!previous && !next) return null;

  return (
    <nav className="mx-auto mt-14 grid max-w-3xl gap-3 border-t border-line pt-8 sm:grid-cols-2">
      {previous ? (
        <Link
          to={previous.url}
          className="group flex flex-col gap-1 rounded-xl border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-soft"
        >
          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-text-subtle">
            <IconArrowLeft className="size-3" strokeWidth={2} />
            Previous
          </span>
          <span className="text-sm font-medium text-foreground">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to={next.url}
          className="group flex flex-col items-end gap-1 rounded-xl border border-line px-4 py-3 text-right transition-colors hover:border-line-strong hover:bg-surface-soft sm:col-start-2"
        >
          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-text-subtle">
            Next
            <IconArrowRight className="size-3" strokeWidth={2} />
          </span>
          <span className="text-sm font-medium text-foreground">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
