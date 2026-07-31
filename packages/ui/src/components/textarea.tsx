/**
 * Downcity Textarea 基础组件。
 *
 * 关键说明（中文）
 * - 用于多行文本、Prompt、环境变量片段等输入场景。
 * - 默认保留较舒展的内边距，适合配置面板中的长文本编辑。
 */

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Textarea 组件属性。
 *
 * 关键说明（中文）
 * - 直接复用原生 `textarea` 属性，保证宿主应用接入成本最低。
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "w-full rounded-lg border border-transparent bg-control-surface p-2 text-left text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-control-hover focus:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 resize-none",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
