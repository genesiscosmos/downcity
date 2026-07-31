/**
 * Downcity Typography 内容排版原语。
 *
 * 关键说明（中文）
 * - 提供稳定的语义标签、文字层级与内容结构，不拥有页面级间距。
 * - 所有颜色、边界和注释表面均消费 ThemeContainer 主题变量。
 * - InlineCode 只用于行内源码；围栏代码继续交给 CodeBlock 与构建期高亮。
 */

import * as React from "react";

import { cn } from "../lib/utils";
import type {
  DowncityAnnotationProps,
  DowncityDefinitionDescriptionProps,
  DowncityDefinitionListProps,
  DowncityDefinitionTermProps,
  DowncityFootnoteItemProps,
  DowncityFootnoteReferenceProps,
  DowncityFootnotesProps,
  DowncityTaskListItemProps,
  DowncityTypographyBlockquoteProps,
  DowncityTypographyHeadingProps,
  DowncityTypographyInlineCodeProps,
  DowncityTypographyListItemProps,
  DowncityTypographyOrderedListProps,
  DowncityTypographyParagraphProps,
  DowncityTypographySpanProps,
  DowncityTypographyUnorderedListProps,
} from "../types/components";

/** 创建具有统一类型和 ref 行为的标题组件。 */
function create_heading(
  tag_name: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  class_name: string,
) {
  return React.forwardRef<HTMLHeadingElement, DowncityTypographyHeadingProps>(
    ({ className, ...props }, ref) => React.createElement(tag_name, {
      ref,
      className: cn(class_name, className),
      ...props,
    }),
  );
}

const H1 = create_heading("h1", "text-3xl font-semibold leading-tight tracking-tight text-foreground");
const H2 = create_heading("h2", "text-2xl font-semibold leading-tight tracking-tight text-foreground");
const H3 = create_heading("h3", "text-xl font-semibold leading-snug tracking-tight text-foreground");
const H4 = create_heading("h4", "text-lg font-medium leading-snug text-foreground");
const H5 = create_heading("h5", "text-base font-medium leading-snug text-foreground");
const H6 = create_heading("h6", "text-sm font-medium leading-snug text-foreground");

const Paragraph = React.forwardRef<HTMLParagraphElement, DowncityTypographyParagraphProps>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("text-sm leading-6 text-foreground/90", className)} {...props} />,
);

const Lead = React.forwardRef<HTMLParagraphElement, DowncityTypographyParagraphProps>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("text-base leading-7 text-muted-foreground", className)} {...props} />,
);

const Small = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"small">>(
  ({ className, ...props }, ref) => <small ref={ref} className={cn("text-xs leading-5 text-foreground", className)} {...props} />,
);

const Muted = React.forwardRef<HTMLSpanElement, DowncityTypographySpanProps>(
  ({ className, ...props }, ref) => <span ref={ref} className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />,
);

const Strong = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"strong">>(
  ({ className, ...props }, ref) => <strong ref={ref} className={cn("font-semibold text-foreground", className)} {...props} />,
);

const Emphasis = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"em">>(
  ({ className, ...props }, ref) => <em ref={ref} className={cn("italic text-foreground", className)} {...props} />,
);

const InlineCode = React.forwardRef<HTMLElement, DowncityTypographyInlineCodeProps>(
  ({ className, ...props }, ref) => <code ref={ref} className={cn("rounded-md border border-border-subtle bg-control-surface px-1.5 py-0.5 font-mono text-[0.85em] text-foreground", className)} {...props} />,
);

const Blockquote = React.forwardRef<HTMLQuoteElement, DowncityTypographyBlockquoteProps>(
  ({ className, ...props }, ref) => <blockquote ref={ref} className={cn("border-l-2 border-divider pl-4 text-sm italic leading-6 text-muted-foreground", className)} {...props} />,
);

const UnorderedList = React.forwardRef<HTMLUListElement, DowncityTypographyUnorderedListProps>(
  ({ className, ...props }, ref) => <ul ref={ref} className={cn("list-disc pl-5 text-sm leading-6 text-foreground/90 marker:text-muted-foreground", className)} {...props} />,
);

const OrderedList = React.forwardRef<HTMLOListElement, DowncityTypographyOrderedListProps>(
  ({ className, ...props }, ref) => <ol ref={ref} className={cn("list-decimal pl-5 text-sm leading-6 text-foreground/90 marker:text-muted-foreground", className)} {...props} />,
);

const ListItem = React.forwardRef<HTMLLIElement, DowncityTypographyListItemProps>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn("pl-1", className)} {...props} />,
);

const Anchor = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<"a">>(
  ({ className, ...props }, ref) => <a ref={ref} className={cn("font-medium text-foreground underline decoration-divider underline-offset-4 transition-colors hover:decoration-foreground", className)} {...props} />,
);

const Hr = React.forwardRef<HTMLHRElement, React.ComponentPropsWithoutRef<"hr">>(
  ({ className, ...props }, ref) => <hr ref={ref} className={cn("border-divider", className)} {...props} />,
);

/** 渲染与正文共享主题语义的注释块。 */
function Annotation({
  children,
  className,
  title,
  tone = "note",
  ...props
}: DowncityAnnotationProps) {
  return (
    <aside
      data-slot="annotation"
      data-tone={tone}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm leading-6",
        tone === "note" && "border-divider bg-surface-subtle text-foreground",
        tone === "info" && "border-primary/20 bg-primary/5 text-foreground",
        tone === "warning" && "border-warning/25 bg-warning/5 text-foreground",
        tone === "danger" && "border-destructive/25 bg-destructive/8 text-foreground",
        className,
      )}
      {...props}
    >
      {title ? <div className="mb-1 text-xs font-medium text-foreground">{title}</div> : null}
      <div className="text-muted-foreground">{children}</div>
    </aside>
  );
}

/** 渲染正文中的可访问脚注引用。 */
function FootnoteReference({ className, label, ...props }: DowncityFootnoteReferenceProps) {
  return <sup><a data-slot="footnote-reference" className={cn("ml-0.5 rounded-sm font-mono text-[0.7em] font-semibold text-foreground underline decoration-divider underline-offset-2 hover:decoration-foreground", className)} {...props}>[{label}]</a></sup>;
}

/** 渲染文章末尾的脚注区域。 */
function Footnotes({ children, className, title = "Footnotes", ...props }: DowncityFootnotesProps) {
  return <section data-slot="footnotes" className={cn("border-t border-divider pt-4", className)} {...props}><H5>{title}</H5><OrderedList className="mt-3 flex flex-col gap-2 text-xs">{children}</OrderedList></section>;
}

/** 渲染单条脚注以及可选的正文返回链接。 */
function FootnoteItem({ back_href, back_label = "Back to reference", children, className, ...props }: DowncityFootnoteItemProps) {
  return <ListItem data-slot="footnote-item" className={cn("pl-1 text-xs leading-5 text-muted-foreground", className)} {...props}>{children}{back_href ? <a href={back_href} aria-label={back_label} className="ml-1 font-medium text-foreground no-underline">↩</a> : null}</ListItem>;
}

/** 渲染带只读完成状态的任务列表项。 */
function TaskListItem({ checked = false, children, className, ...props }: DowncityTaskListItemProps) {
  return <li data-slot="task-list-item" data-checked={checked ? "true" : "false"} className={cn("flex list-none items-start gap-2 pl-0 text-sm leading-6 text-foreground/90", checked && "text-muted-foreground line-through", className)} {...props}><span aria-hidden="true" className={cn("mt-1.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-divider bg-control-surface text-[9px] leading-none", checked && "border-selection-surface bg-selection-surface text-selection-foreground")}>{checked ? "✓" : null}</span><span>{children}</span></li>;
}

const DefinitionList = React.forwardRef<HTMLDListElement, DowncityDefinitionListProps>(
  ({ className, ...props }, ref) => <dl ref={ref} className={cn("grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]", className)} {...props} />,
);

const DefinitionTerm = React.forwardRef<HTMLElement, DowncityDefinitionTermProps>(
  ({ className, ...props }, ref) => <dt ref={ref} className={cn("font-medium text-foreground", className)} {...props} />,
);

const DefinitionDescription = React.forwardRef<HTMLElement, DowncityDefinitionDescriptionProps>(
  ({ className, ...props }, ref) => <dd ref={ref} className={cn("text-muted-foreground", className)} {...props} />,
);

export {
  Anchor,
  Annotation,
  Blockquote,
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  Emphasis,
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  Hr,
  FootnoteItem,
  FootnoteReference,
  Footnotes,
  InlineCode,
  Lead,
  ListItem,
  Muted,
  OrderedList,
  Paragraph,
  Small,
  Strong,
  TaskListItem,
  UnorderedList,
};
