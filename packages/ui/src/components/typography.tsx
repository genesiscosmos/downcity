/**
 * Downcity Typography 排版原语。
 *
 * 关键说明（中文）
 * - 复刻 Vibecape renderer 的稳定文本层级。
 * - 仅提供语义标签与样式，不承载页面间距策略。
 */

import * as React from "react";

import { cn } from "../lib/utils";

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;

function create_heading(tag_name: "h1" | "h2" | "h3" | "h4", class_name: string) {
  return React.forwardRef<HTMLHeadingElement, HeadingProps>(({ className, ...props }, ref) =>
    React.createElement(tag_name, { ref, className: cn(class_name, className), ...props }),
  );
}

const H1 = create_heading("h1", "text-2xl font-bold text-foreground");
const H2 = create_heading("h2", "text-xl font-semibold text-foreground");
const H3 = create_heading("h3", "text-lg font-semibold text-foreground");
const H4 = create_heading("h4", "text-base font-medium text-foreground");

const Anchor = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  ({ className, ...props }, ref) => <a ref={ref} className={cn("text-primary transition-colors hover:text-primary/80", className)} {...props} />,
);
Anchor.displayName = "Anchor";

const Hr = React.forwardRef<HTMLHRElement, React.HTMLAttributes<HTMLHRElement>>(
  ({ className, ...props }, ref) => <hr ref={ref} className={cn("border-border", className)} {...props} />,
);
Hr.displayName = "Hr";

export { Anchor, H1, H2, H3, H4, Hr };
