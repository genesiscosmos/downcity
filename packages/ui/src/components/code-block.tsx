"use client";

/**
 * Downcity CodeBlock 代码展示组件。
 *
 * 关键说明（中文）
 * - 接收普通代码文本或构建期高亮后的 React children。
 * - 只负责代码块布局与复制交互，不在浏览器中加载语法高亮引擎。
 */

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import type { DowncityCodeBlockProps } from "../types/components";
import { cn } from "../lib/utils";

function CodeBlock({
  children,
  className,
  code,
  language,
  label,
  "data-raw": data_raw,
  "data-language": data_language,
  ...props
}: DowncityCodeBlockProps) {
  const [is_copied, set_is_copied] = useState(false);
  const raw_code = code ?? data_raw ?? "";
  const resolved_language = language ?? data_language;

  const copy_code = async () => {
    if (!raw_code) return;
    await navigator.clipboard.writeText(raw_code);
    set_is_copied(true);
  };

  return (
    <div
      data-slot="code-block"
      className="overflow-hidden rounded-lg border border-border bg-muted text-foreground"
    >
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-divider px-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground/60">
          {label ?? resolved_language ?? "code"}
        </span>
        {raw_code ? (
          <button
            type="button"
            onClick={() => void copy_code()}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground"
          >
            {is_copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            {is_copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <pre
        data-language={resolved_language}
        className={cn(
          "overflow-x-auto bg-transparent p-3 font-mono text-xs leading-5 [tab-size:2] [&_code]:font-inherit",
          className,
        )}
        {...props}
      >
        {children ?? <code>{raw_code}</code>}
      </pre>
    </div>
  );
}

export { CodeBlock };
