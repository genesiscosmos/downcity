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

/** 为未经过构建期 Shiki 处理的短代码提供 GitHub Light 风格的轻量语法着色。 */
function render_fallback_highlight(code: string) {
  const token_pattern = /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|return|function|const|let|type|interface|extends|if|else|async|await|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z0-9_$]*\b|\b[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\())/g;
  return code.split("\n").map((line, line_index) => <span key={line_index} className="block min-h-5">{line.split(token_pattern).filter(Boolean).map((token, token_index) => <span key={token_index} className={token.startsWith("//") ? "text-code-comment italic" : /^("|'|`)/.test(token) ? "text-code-string" : /^(import|from|export|return|function|const|let|type|interface|extends|if|else|async|await|true|false|null|undefined)$/.test(token) ? "text-code-keyword" : /^\d/.test(token) ? "text-code-number" : /^[A-Z]/.test(token) ? "text-code-type" : /^[A-Za-z_$]/.test(token) ? "text-code-function" : undefined}>{token}</span>)}</span>);
}

function CodeBlock({
  children,
  className,
  code,
  language,
  label,
  "data-raw": data_raw,
  "data-language": data_language,
  style,
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
      className="group/code-block overflow-hidden rounded-lg border border-code-border bg-code-background text-code-foreground"
    >
      <div className="relative flex h-9 items-center px-3">
        <span className="truncate font-mono text-[11px] font-medium text-muted-foreground">
          {label ?? resolved_language ?? "code"}
        </span>
        {raw_code ? (
          <button
            type="button"
            onClick={() => void copy_code()}
            aria-label={is_copied ? "Copied" : "Copy code"}
            title={is_copied ? "Copied" : "Copy code"}
            className="absolute inset-y-1 right-1 inline-flex size-7 items-center justify-center rounded-md text-code-foreground/60 opacity-0 outline-none transition-[color,background-color,opacity] group-hover/code-block:opacity-100 focus-visible:opacity-100 hover:bg-code-foreground/8 hover:text-code-foreground"
          >
            {is_copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </button>
        ) : null}
      </div>
      <pre
        data-language={resolved_language}
        className={cn(
          "overflow-x-auto bg-transparent px-3 pb-3 font-mono text-xs leading-5 [tab-size:2] [&_code]:font-inherit",
          className,
        )}
        style={{ ...style, backgroundColor: "transparent" }}
        {...props}
      >
        {children ?? <code>{render_fallback_highlight(raw_code)}</code>}
      </pre>
    </div>
  );
}

export { CodeBlock };
