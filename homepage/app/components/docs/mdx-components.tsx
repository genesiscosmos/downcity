/**
 * MDX 正文组件集。
 *
 * 文档与文章正文都通过 `getMDXComponents` 渲染，本模块统一提供正文所需的组件：
 * 站内链接规范化、代码块、提示框、图表与组件预览。
 *
 * 关于代码块：MDX 编译期的 `rehypeCode` 已经产出 shiki 高亮标记（内联 CSS 变量），
 * 这里只需提供容器、滚动区域与复制按钮，因此直接接管 `pre` 元素而不是重新高亮。
 */
import { lazy, Suspense, useCallback, useState, type ComponentProps, type FC } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type { MDXComponents } from "mdx/types";
import { cn } from "@/lib/utils";
import { create_internal_href } from "@/lib/seo";
import { ComponentPreview } from "@/components/docs/component-preview";

/**
 * 正文锚点。
 *
 * 站点规范 URL 一律带尾斜杠，但 MDX 正文里的站内链接大量写成无尾斜杠形态，每条都会
 * 让 Cloudflare Pages 返回 308。集中在这里规范化比逐个改 MDX 更安全，外链、锚点、
 * 查询串与哈希片段都原样保留。
 */
const Anchor: FC<ComponentProps<"a">> = ({ href, className, ...props }) => (
  <a
    {...props}
    href={href ? create_internal_href(href) : href}
    className={cn("font-medium text-foreground underline underline-offset-4", className)}
  />
);

/**
 * 编译期写入 `pre` 的元数据字段。
 *
 * 这些字段由 MDX 编译插件生成，原本由框架自己的代码块组件消费；在我们的渲染层里
 * 它们没有对应 DOM 属性，直接透传会输出非法属性（`icon` 实测会长达 1KB 以上）。
 */
const compile_time_pre_attributes = new Set(["icon", "tabIndex", "language", "data-language"]);

/** 剔除编译期元数据，只保留可安全输出到 DOM 的属性。 */
function pick_dom_attributes(attributes: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !compile_time_pre_attributes.has(key)),
  );
}

/**
 * 代码块容器。
 *
 * 结构对应 shiki 的输出：外层 `figure` 承载边框与背景，内层滚动区域承载高亮代码。
 * 复制按钮读取 `pre` 的文本，因此复制结果是纯代码而不是带高亮标记的 HTML。
 *
 * 行高与字号统一由 `.docs-code-block` 控制，不从组件层写 Tailwind 类：外层容器同时
 * 承载 `overflow-x-auto`，两层各写一套行高会互相覆盖。
 */
const CodeBlock: FC<ComponentProps<"pre">> = ({ children, className, style, ...props }) => {
  const [copied, set_copied] = useState(false);

  const copy_code = useCallback(async (element: HTMLPreElement | null) => {
    const text = element?.textContent ?? "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      set_copied(true);
      window.setTimeout(() => set_copied(false), 1500);
    } catch {
      // 剪贴板不可用时保持静默，不打断阅读。
    }
  }, []);

  return (
    <figure className="group relative my-5 overflow-hidden rounded-xl border border-line bg-surface-soft">
      <div className="absolute right-2 top-2 z-2">
        <button
          type="button"
          aria-label="Copy code"
          onClick={(event) =>
            copy_code(event.currentTarget.closest("figure")?.querySelector("pre") ?? null)
          }
          className="inline-flex size-7 items-center justify-center rounded-md bg-surface/80 text-text-soft opacity-0 backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? (
            <IconCheck className="size-3.5" strokeWidth={2} />
          ) : (
            <IconCopy className="size-3.5" strokeWidth={1.7} />
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        {/* `style` 必须保留：shiki 把两套主题颜色写在 pre 的内联变量上。 */}
        <pre
          {...pick_dom_attributes(props as Record<string, unknown>)}
          style={style}
          className={cn("docs-code-block", className)}
        >
          {children}
        </pre>
      </div>
    </figure>
  );
};

/**
 * 行内代码。
 *
 * 这里只负责去掉编译期元数据，视觉样式全部交给 CSS 的 `.docs-markdown :not(pre) > code`：
 * MDX 不区分行内代码与围栏代码块内部的 `code`，两者共用同一个组件。若在这里直接写
 * 边框与内边距类，围栏块里的 `code` 也会被命中，导致代码块多出一圈边框、字号被
 * `text-[0.82em]` 缩小（实测从 13px 降到 10.7px）。
 */
const InlineCode: FC<ComponentProps<"code">> = ({ className, ...props }) => (
  <code {...props} className={className} />
);

/** 正文表格容器，宽表格独立横向滚动而不撑破版心。 */
const Table: FC<ComponentProps<"table">> = ({ className, ...props }) => (
  <div className="my-5 overflow-x-auto rounded-xl border border-line">
    <table {...props} className={cn("w-full border-collapse text-sm", className)} />
  </div>
);

/** 提示框的语义变体。 */
type CalloutTone = "info" | "warn" | "success";

/** 各变体的边框与底色。 */
const callout_tone_class: Record<CalloutTone, string> = {
  info: "border-line bg-surface-soft",
  warn: "border-danger-border bg-danger-soft",
  success: "border-success-border bg-success-soft",
};

/**
 * 提示框。
 *
 * 语义与原先的 Callout 对齐（`type` 决定语气），但外观走本站的语义色令牌，
 * 不再依赖文档框架的 `fd-` 变量。
 */
export const Callout: FC<
  ComponentProps<"div"> & { type?: CalloutTone; title?: string }
> = ({ type = "info", title, className, children, ...props }) => (
  <div
    {...props}
    className={cn("my-5 rounded-xl border px-4 py-3.5 text-sm leading-relaxed", callout_tone_class[type], className)}
  >
    {title ? <p className="mb-1.5 font-semibold text-foreground">{title}</p> : null}
    <div className="text-text-soft [&_a]:text-foreground">{children}</div>
  </div>
);

/**
 * 按需加载 Mermaid。
 *
 * `mermaid` 会连带引入 chroma-js、rough.js、graphlib 等一批依赖，静态引入会让所有
 * MDX 页面都被写进这条依赖边，即使正文里一张图都没有。改成动态导入后只有真的出现
 * 图表时才会取这段代码；图表本来就是客户端渲染，渲染时机没有变化。
 */
const LazyMermaid = lazy(() =>
  import("@/components/mermaid").then((module) => ({ default: module.Mermaid })),
);

const Mermaid: FC<{ chart: string }> = (props) => (
  <Suspense
    fallback={
      <div
        aria-hidden="true"
        className="my-6 h-48 animate-pulse rounded-xl border border-line bg-surface-soft"
      />
    }
  >
    <LazyMermaid {...props} />
  </Suspense>
);

/** 组装正文组件集。 */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    a: Anchor,
    pre: CodeBlock,
    code: InlineCode,
    table: Table,
    Callout,
    Mermaid,
    ComponentPreview,
    ...components,
  };
}
